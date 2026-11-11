// Hover for ShaderLab/HLSL files: HLSL intrinsic signatures/docs, HLSL semantics/keywords, curated
// Unity/URP built-ins, and the resolved absolute path for `#include "..."` directives. Gated by
// shaderlabKit.suggest.enable. HLSL/URP scope only — see shaderlab-domain skill.

import * as vscode from 'vscode';
import functionsData from '../data/functions.json';
import keywordsData from '../data/keywords.json';
import { URP_BUILTINS, URP_STRUCTS } from '../data/urpBuiltins';
import { getSemanticDoc } from '../data/hlslSemantics';
import { PRAGMAS, PROPERTY_ATTRIBUTES, SHADERLAB_STATEMENTS, TAG_KEYS, TAG_VALUES } from '../data/shaderlabSyntax';
import { findVariableStructType } from '../analysis/shaderSymbols';
import { ResolvedSymbols, getResolvedSymbols } from '../analysis/documentSymbols';
import { builtinDoc, entryDoc, functionDoc, keywordDoc, macroDoc, propertyDoc, structDoc } from './symbolDocs';
import { resolveInclude } from '../unity/includeResolver';
import { findIncludeDirective } from '../utils/lineDirectives';
import { maskDocument, maskLine } from '../utils/commentMask';
import {
	EXCLUDED_ENTRYPOINT_NAMES,
	EXCLUDED_LEGACY_KEYWORDS,
	PROPERTY_TYPE_POSITION_PATTERN,
	PROPERTY_TYPE_SNIPPETS,
	SHADERLAB_PRO_DOCUMENT_SELECTOR,
	getBlockStack,
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
	return builtin ? builtinDoc(builtin) : undefined;
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

/** Hover for `[Attribute]` names inside a `Properties { }` block. */
function propertyAttributeHover(document: vscode.TextDocument, wordRange: vscode.Range, word: string): vscode.MarkdownString | undefined {
	const entry = PROPERTY_ATTRIBUTES.find((a) => a.name === word);
	if (!entry) {
		return undefined;
	}
	const before = maskLine(document.lineAt(wordRange.start.line).text.substring(0, wordRange.start.character)).masked;
	if (!/\[\s*$/.test(before) || !isInsidePropertiesBlock(document, wordRange.start)) {
		return undefined;
	}
	return entryDoc(entry.doc);
}

/** Hover for ShaderLab statements (`ZWrite`, `ColorMask`, `FallBack`, `CustomEditor`, …) in ShaderLab scope. */
function statementHover(document: vscode.TextDocument, wordRange: vscode.Range, word: string): vscode.MarkdownString | undefined {
	const entry = SHADERLAB_STATEMENTS.find((e) => e.name === word);
	if (!entry) {
		return undefined;
	}
	const before = maskLine(document.lineAt(wordRange.start.line).text.substring(0, wordRange.start.character)).masked;
	if (before.trim() !== '' && !/[{;]\s*$/.test(before)) {
		return undefined;
	}
	const stack = getBlockStack(document, wordRange.start);
	if (stack.includes('HLSL') || (stack.length === 0 && word !== 'HLSLPROGRAM')) {
		return undefined;
	}
	return entryDoc(entry.doc);
}

/** Hover for `Tags { "Key" = "Value" }` keys and values. */
function tagHover(document: vscode.TextDocument, position: vscode.Position): vscode.MarkdownString | undefined {
	const line = document.lineAt(position.line).text;
	if (!/\bTags\b/.test(line) && getBlockStack(document, position).pop() !== 'Tags') {
		return undefined;
	}
	const pairRegex = /"([^"]*)"\s*=\s*"([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = pairRegex.exec(line))) {
		const keyStart = m.index + 1;
		const keyEnd = keyStart + m[1].length;
		const valueEnd = m.index + m[0].length - 1;
		const valueStart = valueEnd - m[2].length;
		if (position.character >= keyStart && position.character <= keyEnd) {
			const key = TAG_KEYS.find((k) => k.name === m![1]);
			return key ? entryDoc(`**${key.name}** — ${key.doc}`) : undefined;
		}
		if (position.character >= valueStart && position.character <= valueEnd) {
			const value = TAG_VALUES[m[1]]?.find((v) => m![2] === v.name || m![2].startsWith(`${v.name}+`) || m![2].startsWith(`${v.name}-`));
			return value ? entryDoc(`**${m[1]} = ${value.name}** — ${value.doc}`) : undefined;
		}
	}
	return undefined;
}

/** Hover for the directive name after `#pragma`. */
function pragmaHover(document: vscode.TextDocument, wordRange: vscode.Range, word: string): vscode.MarkdownString | undefined {
	const before = maskLine(document.lineAt(wordRange.start.line).text.substring(0, wordRange.start.character)).masked;
	if (!/^\s*#\s*pragma\s+$/.test(before)) {
		return undefined;
	}
	const entry = PRAGMAS.find((p) => p.name === word);
	return entry ? entryDoc(entry.doc) : undefined;
}

/** Hover for user-defined symbols: properties, keywords, macros, functions, structs. */
function userSymbolHover(word: string, symbols: ResolvedSymbols): vscode.MarkdownString | undefined {
	const { all, origins } = symbols;
	const property = all.properties.find((p) => p.name === word);
	if (property) {
		return propertyDoc(property);
	}
	const fn = all.functions.find((f) => f.name === word);
	if (fn) {
		return functionDoc(fn, origins.get(word));
	}
	const macro = all.macros.find((m) => m.name === word);
	if (macro) {
		return macroDoc(macro, origins.get(word));
	}
	const struct = all.structs.find((st) => st.name === word);
	if (struct) {
		return structDoc(struct, origins.get(word));
	}
	const keyword = all.keywords.find((k) => k.name === word);
	return keyword ? keywordDoc(keyword) : undefined;
}

/** Hover for `var.member` where `var` is declared with a user or well-known URP struct type. */
function memberHover(document: vscode.TextDocument, wordRange: vscode.Range, word: string, symbols: ResolvedSymbols): vscode.MarkdownString | undefined {
	const before = document.getText(new vscode.Range(new vscode.Position(0, 0), wordRange.start));
	const access = maskDocument(before).match(/(?<![\w.])([A-Za-z_]\w*)\.$/);
	if (!access) {
		return undefined;
	}
	const typeNames = new Set([...symbols.all.structs.map((st) => st.name), ...URP_STRUCTS.map((st) => st.name)]);
	const typeName = findVariableStructType(maskDocument(before).slice(0, -access[0].length), access[1], typeNames);
	if (!typeName) {
		return undefined;
	}
	const userField = symbols.all.structs.find((st) => st.name === typeName)?.fields.find((f) => f.name === word);
	if (userField) {
		const doc = new vscode.MarkdownString();
		doc.appendCodeblock(`${userField.type} ${userField.name}${userField.semantic ? ` : ${userField.semantic}` : ''}`, 'hlsl');
		doc.appendMarkdown(`_Member of \`${typeName}\`_`);
		return doc;
	}
	const builtinStruct = URP_STRUCTS.find((st) => st.name === typeName);
	const member = builtinStruct?.members.find((mem) => mem.name === word);
	if (member) {
		const doc = new vscode.MarkdownString();
		doc.appendCodeblock(`${member.type} ${member.name}`, 'hlsl');
		doc.appendMarkdown(`${member.doc}\n\n_Member of \`${typeName}\` (${builtinStruct?.source})_`);
		return doc;
	}
	return undefined;
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

		const tag = tagHover(document, position);
		if (tag) {
			return new vscode.Hover(tag, wordRange);
		}

		const symbols = await getResolvedSymbols(document);
		const markdown = propertyTypeHover(document, position, wordRange)
			?? propertyAttributeHover(document, wordRange, word)
			?? pragmaHover(document, wordRange, word)
			?? statementHover(document, wordRange, word)
			?? memberHover(document, wordRange, word, symbols)
			?? userSymbolHover(word, symbols)
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
