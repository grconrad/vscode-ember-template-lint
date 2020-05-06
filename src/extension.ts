import {
  languages,
  window,
  workspace,
  ExtensionContext,
  OutputChannel,
} from 'vscode';

import { updateDiagnostics } from './linter';

const { publisher, name, version } = require('../package.json');

let outputChannel: OutputChannel;

function log(s: string): void {
  outputChannel?.append(s);
}

export async function activate(context: ExtensionContext): Promise<void> {
  outputChannel = window.createOutputChannel('Ember Template Lint');
  context.subscriptions.push(outputChannel);

  log(`Activating ${publisher}.${name}@${version}`);

  const collection = languages.createDiagnosticCollection();
  if (window.activeTextEditor) {
    updateDiagnostics(window.activeTextEditor.document, collection);
  }

  // Trigger linting on save if our solution always reads the file from disk.

  context.subscriptions.push(workspace.onDidSaveTextDocument(textDocument => {
    updateDiagnostics(textDocument, collection);
  }));

  // Trigger linting when the active editor changes, or when the document being edited is changed,
  // if our solution can supply input to the linter directory from the in-memory document (not yet
  // saved to disk).

  context.subscriptions.push(window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      updateDiagnostics(editor.document, collection);
    }
  }));
  context.subscriptions.push(workspace.onDidChangeTextDocument(textDocumentChangeEvent => {
    updateDiagnostics(textDocumentChangeEvent.document, collection);
  }));
}

export function deactivate(): void {
  log(`Deactivated ${publisher}.${name}@${version}`);
}
