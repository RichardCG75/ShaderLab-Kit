// Go-to-definition for ShaderLab/HLSL files: `#include "..."` jumps to the resolved file, and
// `Fallback "Shader/Name"` jumps to the matching `Shader "Shader/Name"` declaration elsewhere in the
// workspace. Gated by shaderlabKit.suggest.enable. HLSL/URP scope only — see shaderlab-domain skill.

import * as vscode from 'vscode';
import { resolveInclude } from '../unity/includeResolver';
import { findFallbackDirective, findIncludeDirective } from '../utils/lineDirectives';
import { SHADERLAB_PRO_DOCUMENT_SELECTOR, isSuggestEnabled } from './completionProvider';

function positionFromOffset(text: string, offset: number): vscode.Position {
	const before = text.substring(0, offset);
	const lines = before.split(/\r\n|\r|\n/);
	const line = lines.length - 1;
	const character = lines[line].length;
	return new vscode.Position(line, character);
}

/** Scans workspace `.shader` files for a `Shader "shaderName"` declaration. */
async function findFallbackShaderLocation(shaderName: string): Promise<vscode.Location | undefined> {
	const needle = `Shader "${shaderName}"`;
	const files = await vscode.workspace.findFiles('**/*.shader', '**/{Library,Temp,node_modules}/**');

	for (const file of files) {
		let text: string;
		try {
			text = Buffer.from(await vscode.workspace.fs.readFile(file)).toString('utf-8');
		} catch {
			continue;
		}
		const index = text.indexOf(needle);
		if (index === -1) {
			continue;
		}
		return new vscode.Location(file, positionFromOffset(text, index));
	}
	return undefined;
}

export class ShaderLabDefinitionProvider implements vscode.DefinitionProvider {
	async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location | undefined> {
		if (!isSuggestEnabled()) {
			return undefined;
		}

		const line = document.lineAt(position.line).text;

		const include = findIncludeDirective(line);
		if (include && position.character >= include.start && position.character <= include.end) {
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
			const resolved = await resolveInclude(include.value, document.uri.fsPath, workspaceFolder);
			return resolved ? new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0)) : undefined;
		}

		const fallback = findFallbackDirective(line);
		if (fallback && position.character >= fallback.start && position.character <= fallback.end) {
			return findFallbackShaderLocation(fallback.value);
		}

		return undefined;
	}
}

export function registerDefinitionProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider(SHADERLAB_PRO_DOCUMENT_SELECTOR, new ShaderLabDefinitionProvider()),
	);
}
