import {
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  Range,
  TextDocument
} from 'vscode';
import * as path from 'path';
const execa = require('execa');
const findUp = require('find-up');

// Save some CPU by not linting immediately after each keystroke in the editor.
// A sub-second delay is not noticeable.
const DELAY_BEFORE_LINT_MS = 0.5 * 1000;

// If the lint operation doesn't complete quickly, cancel it.
// We don't want to degrade the editor experience.
const LINT_TIMEOUT_MS = 2 * 1000;

let lintTimeoutId: NodeJS.Timeout | null = null;

/**
 * Run the linter (if appropriate) and update the diagnostics so that any errors appear in the
 * Problems view.
 *
 * This is meant to be invoked by our event handlers for document editing events.
 *
 * If template linting does not apply to the document being edited, clear the diagnostics.
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
    code: rule,
    message: message,
    severity: (severity === 2) ? DiagnosticSeverity.Error : DiagnosticSeverity.Information,
    source: 'ember-template-linter',
  };
  if (line !== undefined && column !== undefined) {
    // ember-template-lint reports 1-based line and column numbers
    // VS Code wants them 0-based
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
  const targetFilename = path.basename(targetPath);
  console.log(`Target file: ${targetFilename} in dir ${targetDir}`);

  // Find nearest .template-lintrc.js.
  const configFile = findUp.sync('.template-lintrc.js', {
    cwd: targetDir
  });
  console.log(`findUp resolved config file = ${configFile}`);
  let lintErrors: object[] = [];

  // If we found a config file, run the linter in a separate process using the config file's
  // directory as the cwd. This ensures we use that project's ember-template-lint dependency and
  // should ensure its .template-lintrc.js config is resolved correctly. But it can also fail, if
  // e.g. the dependencies have not been vendored (node_modules is missing or does not contain
  // ember-template-lint).
  if (configFile) {
    const configDir = path.dirname(configFile);
    const targetRelativePath = path.relative(configDir, targetPath);

    try {
      const processResult = execa.sync(
        `./node_modules/.bin/ember-template-lint`,
        [
          `--json`,
          `--filename`,
          targetRelativePath,
        ],
        {
          cwd: configDir, // nearest ancestor with a config file
          shell: true,
          input: document.getText(), // pass live document content (maybe unsaved)
          timeout: LINT_TIMEOUT_MS // auto cancel if it takes a long time
        }
      );
      // If we make it here, ember-template-lint exited zero.
      // This seems to indicate that there were no lint errors.
      // There's no need to do anything here; linterErrors is already [].
      // console.log(processResult);
    } catch (error) {
      // execa will throw whenever there are lint errors, because ember-template-lint exits
      // nonzero in that case. We can read the JSON result from the error object's stdout.
      console.log(`error = ${error}`);
      if (!error.timedOut) {
        try {
          const jsonResult = JSON.parse(error.stdout);
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
          // Fish out the errors.
          lintErrors = jsonResult[targetRelativePath];
        } catch (e) {
          // console.log('Error, could not parse JSON');
          console.log(e);
        }
      }
    }
  }

  if (lintErrors.length) {
    // console.log(`Lint errors: ${JSON.stringify(lintErrors, null, 2)}`);
  } else {
    // console.log('No lint errors, or lint operation could not be performed');
  }

  collection.set(document.uri, lintErrors.map(getDiagnosticForLintResult));
}
