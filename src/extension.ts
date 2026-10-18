import * as vscode from 'vscode';
import { registerCompletionProvider } from './providers/completionProvider';
import { registerDefinitionProvider } from './providers/definitionProvider';
import { registerDiagnosticsProvider } from './providers/diagnosticsProvider';
import { registerFormattingProvider } from './providers/formattingProvider';
import { registerHoverProvider } from './providers/hoverProvider';

export function activate(context: vscode.ExtensionContext) {
	registerCompletionProvider(context);
	registerHoverProvider(context);
	registerDefinitionProvider(context);
	registerFormattingProvider(context);
	registerDiagnosticsProvider(context);
	// Further providers register here as they're implemented (see src/providers/).
}

export function deactivate() {}
