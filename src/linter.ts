import {
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  Range,
  TextDocument
} from 'vscode';
import * as cp from 'child_process';
import * as findUp from 'find-up';
import * as path from 'path';

// Save some CPU by not linting immediately after each keystroke in the editor.
// A sub-second delay is not noticeable.
const DELAY_BEFORE_LINT_MS = 0.5 * 1000;

// If the lint operation doesn't complete quickly, cancel it.
// We don't want to degrade the editor experience.
const LINT_TIMEOUT_MS = 1 * 1000;

let lintTimeoutId: NodeJS.Timeout | null = null;

/**
 * Run the linter (if appropriate) and update the diagnostics so that any errors appear in the
 * Problems view.
 *
 * This is meant to be invoked by our document editing event handlers.
 *
 * If template linting is not applicable, clear the diagnostics.
 */
export function updateDiagnostics(document: TextDocument, collection: DiagnosticCollection): void {
  // console.log(`updateDiagnostics: document = ${document.uri}`);

  const isHbsFile = document?.uri?.fsPath?.endsWith('.hbs');
  if (!isHbsFile) {
    collection.clear();
    return;
  }

  // Cancel any previously scheduled lint operation.
  if (lintTimeoutId !== null) {
    // console.log('Canceling scheduled lint');
    clearTimeout(lintTimeoutId);
    lintTimeoutId = null;
  }

  // Schedule the next lint.
  // console.log('Scheduling lint');
  lintTimeoutId = setTimeout(
    () => {
      lintTimeoutId = null;
      lintTemplate(document, collection);
    },
    DELAY_BEFORE_LINT_MS // throttle linting during typing
  );
}

/**
 * Map an item (error) returned by ember-template-lint to a VS Code diagnostic.
 *
 * Per ember-template-lint docs, it returns an array of objects with properties:
 *
 * rule - The name of the rule that triggered this warning/error.
 * message - The message that should be output.
 * line - The line on which the error occurred.
 * column - The column on which the error occurred.
 * moduleId - The module path for the file containing the error.
 * source - The source that caused the error.
 * fix - An object describing how to fix the error.
 */
function getDiagnosticForLintResult(lintResult: any): Diagnostic {
  const { rule, message, severity, line, column } = lintResult;
  const result: any = {
    message: message,
    severity: (severity === 2) ? DiagnosticSeverity.Error : DiagnosticSeverity.Information,
    source: 'ember-template-linter',
  };
  // Observation: rule, line, and column are sometimes missing in the lint error object.
  // This seems to happen when there are basic parse errors fatal to the linter.
  if (rule) {
    result.code = rule;
  }
  if (line !== undefined && column !== undefined) {
    // The linter reports 1-based line numbers. VS Code wants those to be 0-based.

    // As for column numbers, the linter reports only the start column for each issue. Since we
    // don't know the full range of characters causing the issue, just include a single character in
    // the range we hand to VS Code. The editor will show a red squiggly on only a single character,
    // but it's probably better than the alternative (underlining the whole line).

    result.range = new Range(line - 1, column, line - 1, column + 1);
  }
  // console.log(`Giving VS Code the diagnostic: ${JSON.stringify(result, null, 2)}`);
  return result;
}

/**
 * Lint the target file (hbs template).
 */
function lintTemplate(
  document: TextDocument,
  collection: DiagnosticCollection
): void {

  const targetPath = document.uri.fsPath; // absolute path to hbs
  const targetDir = path.dirname(targetPath);
  // console.log(`Target file: ${targetFilename} in dir ${targetDir}`);

  // Find nearest .template-lintrc.js.
  const configFile = findUp.sync('.template-lintrc.js', {
    cwd: targetDir
  });
  // console.log(`findUp resolved config file = ${configFile}`);
  let lintIssues: object[] = [];

  // If we found a config file, run the linter in a separate process using the config file's
  // directory as the cwd. This ensures we use that project's ember-template-lint dependency and
  // should ensure its .template-lintrc.js config is resolved correctly. But it can also fail, if
  // e.g. the dependencies have not been vendored or the CLI can't be found in node_modules or can't
  // be invoked for whatever reason.
  if (configFile) {
    const configDir = path.dirname(configFile);
    const targetRelativePath = path.relative(configDir, targetPath);

    // Invoke ember-template-lint. The result will be similar to the following, with a list of
    // errors keyed by the file path we specify on the command.
    //
    // {
    //   "app/templates/head.hbs": [
    //     {
    //       "fatal": true,
    //       "severity": 2,
    //       "filePath": "app/templates/head.hbs",
    //       "moduleId": "app/templates/head",
    //       "message": "Blah blah blah",
    //       "source": "Error: Blah blah blah"
    //     },
    //     ...
    //   ]
    // }

    const result = cp.spawnSync(
      './node_modules/.bin/ember-template-lint',
      [
        '--json',
        '--filename',
        targetRelativePath,
      ],
      {
        cwd: configDir, // nearest ancestor with a config file
        timeout: LINT_TIMEOUT_MS, // auto cancel if it takes a long time
        input: document.getText(),
      }
    );

    const {signal, status, stdout, stderr, error} = result;

    if (error) {
      // We couldn't run ember-template-lint.
      // It can happen when the project doesn't have node_modules (error.code === ENOENT)

      // Just swallow it
      console.error(error);

    } else {

      let output = stdout.toString();

      // console.log(`signal=${signal}`, `status=${status}`);
      // console.error(`stdout=${output}`);
      // console.error(`stderr=${stderr.toString()}`);

      if (status !== 0 && output !== '') {

        // In CI the test runner environment adds "##[error]" text after the JSON output of
        // ember-template-lint. It's pretty consistently happening in the GitHub Actions workflow,
        // and we have to strip out that part before attempting to parse the JSON.
        if (process.env.CI === 'true') {
          console.error(`before: output=${output}`);
          const testRunnerErrorFragmentIdx = output.indexOf('##[error]');
          console.error(`found marker at position ${testRunnerErrorFragmentIdx}`);
          if (testRunnerErrorFragmentIdx !== -1) {
            output = output.substring(0, testRunnerErrorFragmentIdx);
            console.error(`after: output=${output}`);
          }
        }

        try {
          // If it isn't, it could be a bug in ember-template-lint since we asked for json.
          const jsonResult = JSON.parse(output);

          // Fish out the errors.
          lintIssues = jsonResult[targetRelativePath];

          console.log(`Linter reported ${lintIssues.length} issues`);
        } catch (parseErr) {
          console.error('Could not parse JSON from lint output -----');
          console.error(stdout.toString());
          console.error('-----');
          console.error(parseErr);
        }
      }

    }

  }

  const diagnostics = lintIssues.map(issue => getDiagnosticForLintResult(issue));
  collection.set(document.uri, diagnostics);
  console.error(`${diagnostics.length} issues computed for doc ${document.uri.fsPath}`);
}
