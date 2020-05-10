import * as assert from "assert";
import { before, after } from "mocha";
import * as path from "path";
import {
  extensions,
  languages,
  window,
  workspace,
  DiagnosticSeverity,
} from "vscode";

const FIXTURES_DIR = path.resolve(__dirname, "../../../test-fixtures");

const EXTENSION_ID = "grconrad.vscode-ember-template-lint";

// Allow an extra half second or so for lint results to be available after the linter is invoked.
const SLEEP_AFTER_OPEN_MS = 1.5 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

suite("Extension Test Suite", function () {

  before(function () {
    window.showInformationMessage("Start all tests.");
  });

  after(() => {
    window.showInformationMessage("Done with tests.");
  });

  test("Extension should activate", async function() {
    this.timeout(5 * 1000);

    const extension = extensions.getExtension(EXTENSION_ID);
    if (!extension) {
      throw new Error(`Failed to find extension ${EXTENSION_ID}`);
    } else if (!extension.isActive) {
      try {
        await extension.activate();
      }
      catch (e) {
        console.error(e);
        throw new Error(`Failed to activate extension ${EXTENSION_ID}`);
      }
    }
  });

  // TODO: Consider different behavior for this case.
  //
  // Option 1: Skip linting / return no diagnostics (current behavior)
  //
  // Option 2: Create a warning diagnostic with a message like "Cannot run ember-template-lint;
  // please install dependencies in this project."
  //
  // Option 3: Look for a globally installed ember-template-lint, similar to documented behavior of
  // eslint extension (dbaeumer.vscode-eslint)
  test("Project with no lint config > Any hbs (contents irrelevant)", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.resolve(FIXTURES_DIR, "project-missing-config/foo/ignored.hbs")
    );
    const editor = await window.showTextDocument(hbsDoc);
    assert.equal(window.activeTextEditor, editor, "No active editor");

    await sleep(SLEEP_AFTER_OPEN_MS);

    const diagnostics = languages.getDiagnostics(hbsDoc.uri);
    assert.ok(diagnostics.length === 0, "Expected no diagnostics due to missing lint config");
  });

  // TODO: Consider different behavior for this case.
  //
  // Option 1: Skip linting / return no diagnostics (current behavior)
  //
  // Option 2: Create a warning diagnostic with a message like "Cannot run ember-template-lint;
  // please install dependencies in this project."
  //
  // Option 3: Look for a globally installed ember-template-lint, similar to documented behavior of
  // eslint extension (dbaeumer.vscode-eslint)
  test("Project with no linter > Any template (contents irrelevant)", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.resolve(FIXTURES_DIR, "project-missing-linter/foo/ignored.hbs")
    );
    const editor = await window.showTextDocument(hbsDoc);
    assert.equal(window.activeTextEditor, editor, "No active editor");

    await sleep(SLEEP_AFTER_OPEN_MS);

    const diagnostics = languages.getDiagnostics(hbsDoc.uri);
    assert.ok(diagnostics.length === 0, "Expected no diagnostics due to missing linter");
  });

  test("Complete project > Valid template", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.resolve(FIXTURES_DIR, "sample-project/foo/good.hbs")
    );
    const editor = await window.showTextDocument(hbsDoc);
    assert.equal(window.activeTextEditor, editor, "No active editor");

    await sleep(SLEEP_AFTER_OPEN_MS);

    const diagnostics = languages.getDiagnostics(hbsDoc.uri);
    assert.ok(diagnostics.length === 0, "Expected no diagnostics");
  });

  test("Complete project > Template with invalid syntax", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.resolve(FIXTURES_DIR, "sample-project/foo/invalid-syntax.hbs")
    );
    const editor = await window.showTextDocument(hbsDoc);
    assert.equal(window.activeTextEditor, editor, "No active editor");

    await sleep(SLEEP_AFTER_OPEN_MS);

    const diagnostics = languages.getDiagnostics(hbsDoc.uri);
    assert.ok(diagnostics.length > 0, "Expected some error diagnostics");
    assert.ok(
      diagnostics.some((diagnostic) => {
        const { severity, message } = diagnostic;
        return (severity === DiagnosticSeverity.Error) && message.includes("Parse error");
      }),
      "Expected a parse error from the linter"
    );
  });

  test("Complete project > Template with rule violation", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.resolve(FIXTURES_DIR, "sample-project/foo/rule-violation.hbs")
    );
    const editor = await window.showTextDocument(hbsDoc);
    assert.equal(window.activeTextEditor, editor, "No active editor");

    await sleep(SLEEP_AFTER_OPEN_MS);

    const diagnostics = languages.getDiagnostics(hbsDoc.uri);
    assert.ok(diagnostics.length > 0, "Expected some error diagnostics");
    assert.ok(
      diagnostics.some((diagnostic) => {
        const { severity, code } = diagnostic;
        return (severity === DiagnosticSeverity.Error) && (code === "no-bare-strings");
      }),
      "Expected a parse error from the linter"
    );
  });

});
