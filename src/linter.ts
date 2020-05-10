import {
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  Range,
  TextDocument
} from 'vscode';
import * as path from 'path';
import * as execa from 'execa';
import * as findUp from 'find-up';

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
async function lintTemplate(
  document: TextDocument,
  collection: DiagnosticCollection
): Promise<void> {

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

    try {

      await execa(
        './node_modules/.bin/ember-template-lint',
        [
          '--json',
          '--filename',
          targetRelativePath,
        ],
        {
          cwd: configDir, // nearest ancestor with a config file
          timeout: LINT_TIMEOUT_MS, // auto cancel if it takes a long time
          shell: true,
          input: document.getText(), // pass live document content (maybe unsaved)
        }
      );

      // If we make it here, ember-template-lint exited 0. There's no need to do anything here,
      // since lintIssues is already [].

      // Lint issues cause ember-template-lint to exit nonzero, and execa throws. The 'catch' block
      // below is the expected flow when the lint CLI reports issues.

    } catch (execaErr) {
      // We can read the JSON result from the error object's stdout.

      if (!execaErr.timedOut) {
        if (execaErr.stdout !== '') {
          try {
            const jsonResult = JSON.parse(execaErr.stdout);
            // Result is like the following, with a list of errors keyed by file (relative path).
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
            //

            // console.debug('jsonResult =');
            // console.debug(jsonResult);
            // console.debug('-----');

            // Fish out the errors.
            lintIssues = jsonResult[targetRelativePath];
            console.log(`Found ${lintIssues.length} lint issues`);
          } catch (parseErr) {
            console.error(`Could not parse JSON from lint output`);
            console.error('execaErr (raw)');
            console.error('-----');
            console.error(execaErr);
            console.error(`execaErr.stdout:
  -----
  ${execaErr.stdout}
  -----`    );
            console.error(`execaErr (toString):
  -----
  ${execaErr}
  -----`    );
            console.error(`parseErr:
  -----
  ${parseErr}
  -----`    );
            console.log('execaErr:');
            console.log('-----');
            console.log(execaErr);
            console.log('-----');
          }
        }
      } else {
        console.error('Lint timed out');
      }
    }
  }

  // console.log(`${lintIssues.length} lint issues detected`);

  const diagnostics = lintIssues.map(lintIssue => getDiagnosticForLintResult(lintIssue));
  collection.set(document.uri, diagnostics);
  console.error(`${diagnostics.length} issues computed for doc ${document.uri.fsPath}`);
}
