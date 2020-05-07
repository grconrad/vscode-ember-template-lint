import * as assert from "assert";
import * as execa from "execa";
import { before, after } from "mocha";
import * as path from "path";
import {
  extensions,
  languages,
  window,
  workspace,
  DiagnosticSeverity,
} from "vscode";

const EXTENSION_ID = "grconrad.vscode-ember-template-lint";

const SLEEP_AFTER_OPEN_MS = 0.5 * 1000;

const FIXTURES_DIR = path.resolve(__dirname, "../../../src/test/fixtures");

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

suite("Extension Test Suite", () => {

  before(function () {
    this.timeout(30 * 1000);

    // In sample project with ember-template-lint configured, install dependencies.
    // The presence of ember-template-lint in that project is required in order for our extension to
    // successfully lint a template in the project.
    // We do not populate node_modules in the sample project.
    try {
      const sampleProjectDir = path.join(FIXTURES_DIR, "sample-project");
      execa.commandSync("yarn install", {
        cwd: sampleProjectDir,
        timeout: 30 * 1000
      });
    } catch (err) {
      assert.fail(err);
    }

    // window.showInformationMessage("Start all tests.");
  });

  after(() => {
    // window.showInformationMessage("Done with tests.");
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
  test("hbs in project with no template lint configuration", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.join(FIXTURES_DIR, "project-missing-config", "foo", "any.hbs")
    );
    const editor = await window.showTextDocument(hbsDoc);
    assert.equal(window.activeTextEditor, editor, "No active editor");

    await sleep(SLEEP_AFTER_OPEN_MS);

    const diagnostics = languages.getDiagnostics(hbsDoc.uri);
    assert.ok(diagnostics.length === 0, "Expected no diagnostics");
  });

  test("Valid hbs in project with lint configured", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.join(FIXTURES_DIR, "sample-project", "foo", "good.hbs")
    );
    const editor = await window.showTextDocument(hbsDoc);
    assert.equal(window.activeTextEditor, editor, "No active editor");

    await sleep(SLEEP_AFTER_OPEN_MS);

    const diagnostics = languages.getDiagnostics(hbsDoc.uri);
    assert.ok(diagnostics.length === 0, "Expected no diagnostics");
  });

  test("Invalid hbs in project with lint configured", async function() {
    this.timeout(5 * 1000);

    const hbsDoc = await workspace.openTextDocument(
      path.join(FIXTURES_DIR, "sample-project", "foo", "bad.hbs")
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

});
