// Hover for ShaderLab/HLSL files: HLSL intrinsic signatures/docs, HLSL semantics/keywords, curated
// Unity/URP built-ins, and the resolved absolute path for `#include "..."` directives. Gated by
// shaderlabKit.suggest.enable. HLSL/URP scope only — see shaderlab-domain skill.

import * as vscode from 'vscode';
import functionsData from '../data/functions.json';
import keywordsData from '../data/keywords.json';
import { URP_BUILTINS } from '../data/urpBuiltins';
import { getSemanticDoc } from '../data/hlslSemantics';
import { resolveInclude } from '../unity/includeResolver';
import { findIncludeDirective } from '../utils/lineDirectives';
import { maskLine } from '../utils/commentMask';
import {
	EXCLUDED_ENTRYPOINT_NAMES,
	EXCLUDED_LEGACY_KEYWORDS,
	PROPERTY_TYPE_POSITION_PATTERN,
	PROPERTY_TYPE_SNIPPETS,
	SHADERLAB_PRO_DOCUMENT_SELECTOR,
	isInsidePropertiesBlock,
	isSuggestEnabled,
} from './completionProvider';

type FunctionEntry = { detail?: string; documentation?: string; Synopsis?: string[] };

function functionHover(word: string): vscode.MarkdownString | undefined {
	if (EXCLUDED_ENTRYPOINT_NAMES.has(word)) {
		return undefined;
	}
	const entry = (functionsData.Items as Record<string, FunctionEntry>)[word];
	if (!entry) {
		return undefined;
	}
	const doc = new vscode.MarkdownString();
	if (entry.documentation) {
		doc.appendMarkdown(entry.documentation + '\n\n');
	}
	if (entry.Synopsis?.length) {
		doc.appendCodeblock(entry.Synopsis.join('\n'), 'hlsl');
	}
	return doc;
}

const groups = keywordsData.Items as Record<string, string[]>;
// HLSL semantics are case-insensitive (SV_Target === SV_TARGET === sv_target), but keywords.json
// only lists the all-caps spelling and real-world shader code commonly writes them mixed-case
// (SV_Target, SV_Position). Match case-insensitively; general HLSL keywords (float/half/struct/...)
// ARE case-sensitive in HLSL, so `normal` still matches exactly.
const SEMANTIC_NAMES_UPPER = new Set((groups.reg ?? []).map((name) => name.toUpperCase()));

function keywordHover(word: string): vscode.MarkdownString | undefined {
	if (SEMANTIC_NAMES_UPPER.has(word.toUpperCase())) {
		const doc = getSemanticDoc(word.toUpperCase());
		return new vscode.MarkdownString(doc ? `**${word}** — ${doc}` : `HLSL semantic / register: \`${word}\``);
	}
	if (groups.normal?.includes(word) && !EXCLUDED_LEGACY_KEYWORDS.has(word)) {
		return new vscode.MarkdownString(`HLSL keyword: \`${word}\``);
	}
	return undefined;
}

function urpBuiltinHover(word: string): vscode.MarkdownString | undefined {
	const builtin = URP_BUILTINS.find((b) => b.name === word);
	return builtin ? new vscode.MarkdownString(builtin.detail) : undefined;
}

/** Hover for a ShaderLab property-type keyword (Range/Float/Color/...), only when it's actually in
 *  property-type position inside a `Properties { }` block — not e.g. `Color` used as a variable name. */
function propertyTypeHover(
	document: vscode.TextDocument,
	position: vscode.Position,
	wordRange: vscode.Range,
): vscode.MarkdownString | undefined {
	const word = document.getText(wordRange);
	const entry = PROPERTY_TYPE_SNIPPETS.find((e) => e.label === word);
	if (!entry) {
		return undefined;
	}
	const linePrefix = maskLine(document.lineAt(wordRange.start.line).text.substring(0, wordRange.start.character)).masked;
	if (!PROPERTY_TYPE_POSITION_PATTERN.test(linePrefix) || !isInsidePropertiesBlock(document, wordRange.start)) {
		return undefined;
	}
	return new vscode.MarkdownString(entry.doc);
}

async function includeDirectiveHover(
	document: vscode.TextDocument,
	position: vscode.Position,
	line: string,
): Promise<vscode.Hover | undefined> {
	const include = findIncludeDirective(line);
	if (!include || position.character < include.start || position.character > include.end) {
		return undefined;
	}
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
	const resolved = await resolveInclude(include.value, document.uri.fsPath, workspaceFolder);
	if (!resolved) {
		return undefined;
	}
	const range = new vscode.Range(position.line, include.start, position.line, include.end);
	return new vscode.Hover(new vscode.MarkdownString(`Resolves to \`${resolved}\``), range);
}

export class ShaderLabHoverProvider implements vscode.HoverProvider {
	async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
		if (!isSuggestEnabled()) {
			return undefined;
		}

		const line = document.lineAt(position.line).text;

		const includeHover = await includeDirectiveHover(document, position, line);
		if (includeHover) {
			return includeHover;
		}

		const wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}
		const word = document.getText(wordRange);

		const markdown = propertyTypeHover(document, position, wordRange)
			?? functionHover(word)
			?? urpBuiltinHover(word)
			?? keywordHover(word);
		return markdown ? new vscode.Hover(markdown, wordRange) : undefined;
	}
}

export function registerHoverProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(SHADERLAB_PRO_DOCUMENT_SELECTOR, new ShaderLabHoverProvider()),
	);
}
