// Completion for ShaderLab/HLSL files: generic HLSL intrinsics/semantics (ported data), curated
// Unity/URP built-ins, Pass-state enum values, and #include path completion. Gated by
// shaderlabKit.suggest.enable. HLSL/URP scope only — see shaderlab-domain skill.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import functionsData from '../data/functions.json';
import keywordsData from '../data/keywords.json';
import propertySnippetsData from '../../snippets/shaderlab-kit.json';
import { URP_BUILTINS, URP_STRUCTS } from '../data/urpBuiltins';
import { getSemanticDoc } from '../data/hlslSemantics';
import {
	KEYWORD_PRAGMA_PATTERN, PRAGMAS, PRAGMA_RENDERERS, PRAGMA_TARGETS, PROPERTY_ATTRIBUTES, SHADERLAB_STATEMENTS,
	STATE_VALUES, STENCIL_STATEMENTS, TAG_KEYS, TAG_VALUES,
} from '../data/shaderlabSyntax';
import { ADVANCE_CARRY_LENGTH, advanceBlockStack, findVariableStructType } from '../analysis/shaderSymbols';
import { ResolvedSymbols, getResolvedSymbols } from '../analysis/documentSymbols';
import { maskDocument, maskLine } from '../utils/commentMask';
import { resolveInclude, splitPackageInclude } from '../unity/includeResolver';
import { builtinDoc, entryDoc, functionDoc, keywordDoc, macroDoc, propertyDoc, structDoc } from './symbolDocs';

export const SHADERLAB_PRO_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
	{ language: 'shaderlab' },
	{ language: 'hlsl' },
];

/** ShaderLab `Properties { }` entry types: the snippet tail inserted after `_Name ("Label", `, and a
 *  one-line doc of the full declaration syntax (reused by hoverProvider.ts for property-type hovers). */
export const PROPERTY_TYPE_SNIPPETS: { label: string; insertAfterComma: string; doc: string }[] = [
	{ label: 'Range', insertAfterComma: 'Range(${1:0}, ${2:1})) = ${3:0.5}', doc: '`_Name ("Label", Range(min,max)) = default` — a float clamped to [min,max], shown as a slider in the Inspector.' },
	{ label: 'Float', insertAfterComma: 'Float) = ${1:0}', doc: '`_Name ("Label", Float) = default` — a plain float field.' },
	{ label: 'Int', insertAfterComma: 'Int) = ${1:0}', doc: '`_Name ("Label", Int) = default` — a plain integer field.' },
	{ label: 'Color', insertAfterComma: 'Color) = (${1:1}, ${2:1}, ${3:1}, ${4:1})', doc: '`_Name ("Label", Color) = (r,g,b,a)` — an RGBA color picker.' },
	{ label: 'Vector', insertAfterComma: 'Vector) = (${1:0}, ${2:0}, ${3:0}, ${4:0})', doc: '`_Name ("Label", Vector) = (x,y,z,w)` — a raw 4-component vector field.' },
	{ label: '2D', insertAfterComma: '2D) = "white" {}', doc: '`_Name ("Label", 2D) = "white" {}` — a 2D texture slot (default tint `"white"`/`"black"`/`"gray"`/`"bump"`).' },
	{ label: '3D', insertAfterComma: '3D) = "" {}', doc: '`_Name ("Label", 3D) = "" {}` — a 3D texture slot.' },
	{ label: 'Cube', insertAfterComma: 'Cube) = "" {}', doc: '`_Name ("Label", Cube) = "" {}` — a cubemap texture slot.' },
	{ label: '2DArray', insertAfterComma: '2DArray) = "" {}', doc: '`_Name ("Label", 2DArray) = "" {}` — a 2D texture array slot.' },
];

/** Matches a masked line prefix ending right where a property type keyword belongs, e.g. `_Color ("Color", `. */
export const PROPERTY_TYPE_POSITION_PATTERN = /_\w+\s*\(\s*"[^"]*"\s*,\s*$/;

/**
 * Block-label stack at `position`: one label per unclosed `{` (`Shader`, `SubShader`, `Pass`,
 * `Properties`, `Tags`, `Stencil`, function names, …) plus an `HLSL` pseudo-block between
 * `HLSLPROGRAM`/`HLSLINCLUDE` and `ENDHLSL`. Empty for plain `.hlsl` include files.
 */
export function getBlockStack(document: vscode.TextDocument, position: vscode.Position): string[] {
	const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
	const stack: string[] = [];
	let carry = '';
	for (const line of maskDocument(text).split('\n')) {
		advanceBlockStack(stack, line, carry);
		carry = (carry + line + '\n').slice(-ADVANCE_CARRY_LENGTH);
	}
	return stack;
}

/** Whether `position` is lexically inside an unclosed `Properties { ... }` block. */
export function isInsidePropertiesBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
	const stack = getBlockStack(document, position);
	return stack.length > 0 && stack[stack.length - 1] === 'Properties';
}

/** True in ShaderLab structure (Shader/SubShader/Pass/…), false inside HLSL code or in a bare include file. */
function isShaderLabScope(stack: string[]): boolean {
	return stack.length > 0 && !stack.includes('HLSL');
}

/** Cg-pipeline keywords present in the ported keywords.json that are out of scope and must be excluded. */
export const EXCLUDED_LEGACY_KEYWORDS = new Set(['CGPROGRAM', 'CGINCLUDE', 'ENDCG', 'GLSLPROGRAM', 'GLSLINCLUDE', 'ENDGLSL']);

/**
 * Entries in the ported functions.json that document a legacy *surface-shader* entry-point naming
 * convention (e.g. `#pragma surface surf Standard vertex:vert`) rather than an actual fixed-
 * signature HLSL/Cg intrinsic. These names are also extremely common user-chosen identifiers for a
 * plain HLSLPROGRAM vertex/fragment entry point (e.g. `v2f vert(appdata v)`), so treating them as
 * known global functions causes false positives (wrong-looking "expects N args" diagnostics,
 * misleading completion/hover). Out of scope entirely for this project (surface shaders are legacy
 * Cg pipeline, not HLSLPROGRAM/URP) — excluded everywhere functions.json is consumed.
 */
export const EXCLUDED_ENTRYPOINT_NAMES = new Set(['vert']);

/**
 * Macro-style URP builtins whose `detail` doesn't start with a parseable `Name(args)` signature
 * (unlike the 'function'-kind entries), so their argument placeholder names are hand-specified here.
 */
const MACRO_ARG_NAMES: Record<string, string[]> = {
	TEXTURE2D: ['textureName'],
	TEXTURE2D_ARRAY: ['textureName'],
	TEXTURECUBE: ['textureName'],
	SAMPLER: ['samplerName'],
	UNITY_SETUP_INSTANCE_ID: ['input'],
	UNITY_TRANSFER_INSTANCE_ID: ['input', 'output'],
	UNITY_ACCESS_INSTANCED_PROP: ['propertyBuffer', 'propertyName'],
};

/**
 * Macros that are conventionally written as a standalone statement (`TEXTURE2D(_MainTex);`,
 * `UNITY_SETUP_INSTANCE_ID(v);`) — these get an auto-inserted trailing semicolon. Everything else
 * (HLSL intrinsics, URP functions, UNITY_ACCESS_INSTANCED_PROP) returns a value and is commonly used
 * as a sub-expression, where a forced semicolon would often land in the wrong place.
 */
const STATEMENT_STYLE_MACROS = new Set(['TEXTURE2D', 'TEXTURE2D_ARRAY', 'TEXTURECUBE', 'SAMPLER', 'UNITY_SETUP_INSTANCE_ID', 'UNITY_TRANSFER_INSTANCE_ID']);

/** Escapes characters with special meaning in VS Code snippet syntax ($, }, \). */
function escapeSnippetText(text: string): string {
	return text.replace(/[\\$}]/g, '\\$&');
}

/** Extracts parameter names from a "returnType name(type a, type b, ...)" style signature. */
function parseArgNamesFromSignature(signature: string): string[] {
	const match = signature.match(/\(([^)]*)\)/);
	if (!match || match[1].trim() === '') {
		return [];
	}
	return match[1].split(',').map((param) => {
		const tokens = param.trim().split(/\s+/);
		return tokens[tokens.length - 1]?.replace(/[[\]]/g, '') || 'arg';
	});
}

/** Extracts parameter names from a `Name(args)` prefix at the start of a URP builtin's detail string. */
function parseArgNamesFromDetail(detail: string, name: string): string[] | undefined {
	const match = detail.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(([^)]*)\\)`));
	if (!match) {
		return undefined;
	}
	return match[1].trim() === '' ? [] : match[1].split(',').map((arg) => arg.trim());
}

/** Builds a `name(${1:arg1}, ${2:arg2})` call snippet, with tabstops over each argument and the
 *  final cursor after the closing paren (or after an auto-inserted `;` for statement-style macros). */
function buildCallSnippet(name: string, argNames: string[], withSemicolon: boolean): vscode.SnippetString {
	const args = argNames.map((arg, i) => `\${${i + 1}:${escapeSnippetText(arg)}}`).join(', ');
	return new vscode.SnippetString(`${name}(${args})${withSemicolon ? ';' : ''}$0`);
}

export function isSuggestEnabled(): boolean {
	return vscode.workspace.getConfiguration('shaderlabKit.suggest').get<boolean>('enable', true);
}

function buildFunctionItems(): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	for (const [name, entry] of Object.entries(functionsData.Items as Record<string, { detail?: string; documentation?: string; Synopsis?: string[] }>)) {
		if (EXCLUDED_ENTRYPOINT_NAMES.has(name)) {
			continue;
		}
		const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Function);
		item.detail = entry.Synopsis?.[0] ?? entry.detail;
		const doc = new vscode.MarkdownString();
		if (entry.documentation) {
			doc.appendMarkdown(entry.documentation + '\n\n');
		}
		if (entry.Synopsis?.length) {
			doc.appendCodeblock(entry.Synopsis.join('\n'), 'hlsl');
			item.insertText = buildCallSnippet(name, parseArgNamesFromSignature(entry.Synopsis[0]), false);
		}
		item.documentation = doc;
		items.push(item);
	}
	return items;
}

function buildKeywordItems(): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	const groups = keywordsData.Items as Record<string, string[]>;
	for (const name of groups.reg ?? []) {
		const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Variable);
		const doc = getSemanticDoc(name);
		if (doc) {
			item.documentation = new vscode.MarkdownString(doc);
		}
		items.push(item);
	}
	for (const name of groups.normal ?? []) {
		if (EXCLUDED_LEGACY_KEYWORDS.has(name)) {
			continue;
		}
		items.push(new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword));
	}
	return items;
}

function buildUrpBuiltinItems(): vscode.CompletionItem[] {
	return URP_BUILTINS.map((builtin) => {
		const kind = builtin.kind === 'function' ? vscode.CompletionItemKind.Function
			: builtin.kind === 'macro' ? vscode.CompletionItemKind.Keyword
				: builtin.kind === 'struct' ? vscode.CompletionItemKind.Struct
					: builtin.kind === 'keyword' ? vscode.CompletionItemKind.EnumMember
						: vscode.CompletionItemKind.Constant;
		const item = new vscode.CompletionItem(builtin.name, kind);
		item.detail = builtin.detail.split(' — ')[0];
		item.documentation = builtinDoc(builtin);

		if (builtin.kind === 'function') {
			const argNames = parseArgNamesFromDetail(builtin.detail, builtin.name) ?? [];
			item.insertText = buildCallSnippet(builtin.name, argNames, false);
		} else if (builtin.kind === 'macro') {
			const argNames = MACRO_ARG_NAMES[builtin.name] ?? [];
			item.insertText = buildCallSnippet(builtin.name, argNames, STATEMENT_STYLE_MACROS.has(builtin.name));
		}
		return item;
	});
}

/** Line prefix (up to the cursor) with comments/strings masked, for cheap single-line context checks. */
function maskedPrefix(document: vscode.TextDocument, position: vscode.Position): string {
	const line = document.lineAt(position.line).text.substring(0, position.character);
	return maskLine(line).masked;
}

function enumItems(values: string[]): vscode.CompletionItem[] {
	return values.map((value) => new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
}

/** Comment/string-masked document text from the start up to `position`. */
function maskedTextBefore(document: vscode.TextDocument, position: vscode.Position): string {
	return maskDocument(document.getText(new vscode.Range(new vscode.Position(0, 0), position)));
}

function passStateValueItems(prefix: string, stack: string[]): vscode.CompletionItem[] | undefined {
	const top = stack[stack.length - 1];
	if (top === 'Stencil') {
		const stencil = prefix.match(/^\s*(Comp|Pass|Fail|ZFail)(Front|Back)?\s+\w*$/);
		return stencil ? enumItems(STENCIL_STATEMENTS[stencil[1] + (stencil[2] ?? '')]) : undefined;
	}
	if (!isShaderLabScope(stack)) {
		return undefined;
	}
	const match = prefix.match(/\b(Blend|BlendOp|ZWrite|ZTest|Cull|ColorMask|AlphaToMask)\s+((?:\w+\s+)*)\w*$/);
	// Only `Blend src dst` takes more than one word.
	if (!match || (match[1] !== 'Blend' && match[2] !== '')) {
		return undefined;
	}
	return enumItems(STATE_VALUES[match[1]]);
}

/** `Tags { "Key" = "Value" }` keys and values; uses the raw prefix because strings are masked elsewhere. */
function tagItems(rawPrefix: string, stack: string[]): vscode.CompletionItem[] | undefined {
	if (/\/\//.test(rawPrefix)) {
		return undefined;
	}
	const inTags = stack[stack.length - 1] === 'Tags' || /\bTags\s*\{[^}]*$/.test(rawPrefix);
	if (!inTags) {
		return undefined;
	}
	const value = rawPrefix.match(/"(\w+)"\s*=\s*"[\w+\-]*$/);
	if (value) {
		return (TAG_VALUES[value[1]] ?? []).map(({ name, doc }) => {
			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.EnumMember);
			item.documentation = entryDoc(doc);
			return item;
		});
	}
	if (/"\w*$/.test(rawPrefix)) {
		return TAG_KEYS.map(({ name, doc }) => {
			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
			item.documentation = entryDoc(doc);
			return item;
		});
	}
	return undefined;
}

function propertyAttributeItems(prefix: string): vscode.CompletionItem[] | undefined {
	if (!/\[\s*\w*$/.test(prefix)) {
		return undefined;
	}
	return PROPERTY_ATTRIBUTES.map(({ name, snippet, doc }) => {
		const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
		item.insertText = new vscode.SnippetString(snippet ?? name);
		item.detail = `Material property attribute [${name}]`;
		item.documentation = entryDoc(doc);
		return item;
	});
}

function symbolKeywordItems(symbols: ResolvedSymbols): vscode.CompletionItem[] {
	const items = new Map<string, vscode.CompletionItem>();
	for (const keyword of symbols.all.keywords) {
		const item = new vscode.CompletionItem(keyword.name, vscode.CompletionItemKind.EnumMember);
		item.detail = keyword.drivenBy ? `Shader keyword (set by ${keyword.drivenBy})` : 'Shader keyword';
		item.documentation = keywordDoc(keyword);
		item.sortText = `0_${keyword.name}`;
		items.set(keyword.name, item);
	}
	for (const builtin of URP_BUILTINS.filter((b) => b.kind === 'keyword')) {
		if (!items.has(builtin.name)) {
			const item = new vscode.CompletionItem(builtin.name, vscode.CompletionItemKind.EnumMember);
			item.detail = 'Shader keyword';
			item.documentation = builtinDoc(builtin);
			item.sortText = `1_${builtin.name}`;
			items.set(builtin.name, item);
		}
	}
	return [...items.values()];
}

function pragmaItems(prefix: string, symbols: () => Promise<ResolvedSymbols>): Promise<vscode.CompletionItem[]> | undefined {
	const names = prefix.match(/^\s*#\s*pragma\s+(\w*)$/);
	if (names) {
		return Promise.resolve(PRAGMAS.map(({ name, snippet, doc }) => {
			const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
			item.insertText = new vscode.SnippetString(snippet ?? name);
			item.detail = '#pragma';
			item.documentation = entryDoc(doc);
			return item;
		}));
	}
	const entry = prefix.match(/^\s*#\s*pragma\s+(vertex|fragment|geometry|hull|domain)\s+\w*$/);
	if (entry) {
		return symbols().then((resolved) => resolved.all.functions.map((fn) => {
			const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
			item.detail = `${fn.returnType} ${fn.name}(${fn.params})`;
			item.documentation = functionDoc(fn, resolved.origins.get(fn.name));
			return item;
		}));
	}
	if (/^\s*#\s*pragma\s+target\s+[\w.]*$/.test(prefix)) {
		return Promise.resolve(enumItems(PRAGMA_TARGETS));
	}
	if (/^\s*#\s*pragma\s+(only|exclude)_renderers\s+(?:\w+\s+)*\w*$/.test(prefix)) {
		return Promise.resolve(enumItems(PRAGMA_RENDERERS));
	}
	const keywordLine = prefix.match(/^\s*#\s*pragma\s+(\w+)\s+(?:\S+\s+)*\w*$/);
	if (keywordLine && KEYWORD_PRAGMA_PATTERN.test(keywordLine[1])) {
		return symbols().then((resolved) => {
			const placeholder = new vscode.CompletionItem('_', vscode.CompletionItemKind.EnumMember);
			placeholder.detail = 'No-keyword placeholder (the variant with the keyword off)';
			placeholder.sortText = '0__';
			return [placeholder, ...symbolKeywordItems(resolved)];
		});
	}
	return undefined;
}

function isPreprocessorConditionContext(prefix: string): boolean {
	return /^\s*#\s*(?:if|elif|ifdef|ifndef)\b[^\n]*$/.test(prefix) || /\bdefined\s*\(\s*\w*$/.test(prefix);
}

/** Struct member completion for `var.` — user structs and well-known URP structs. */
function memberItems(maskedBefore: string, symbols: ResolvedSymbols): vscode.CompletionItem[] | undefined {
	const access = maskedBefore.match(/(?<![\w.])([A-Za-z_]\w*)\.(\w*)$/);
	if (!access) {
		return undefined;
	}
	const typeNames = new Set([...symbols.all.structs.map((st) => st.name), ...URP_STRUCTS.map((st) => st.name)]);
	const typeName = findVariableStructType(maskedBefore.slice(0, maskedBefore.length - access[0].length), access[1], typeNames);
	if (!typeName) {
		return undefined;
	}
	const userStruct = symbols.all.structs.find((st) => st.name === typeName);
	if (userStruct) {
		return userStruct.fields.map((field) => {
			const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
			item.detail = `${field.type} ${field.name}${field.semantic ? ` : ${field.semantic}` : ''}`;
			item.documentation = new vscode.MarkdownString(`Member of \`${typeName}\``);
			return item;
		});
	}
	const builtin = URP_STRUCTS.find((st) => st.name === typeName);
	return builtin?.members.map((member) => {
		const item = new vscode.CompletionItem(member.name, vscode.CompletionItemKind.Field);
		item.detail = `${member.type} ${member.name}`;
		item.documentation = new vscode.MarkdownString(`${member.doc}\n\n_Member of \`${typeName}\` (${builtin.source})_`);
		return item;
	});
}

function userSymbolItems(symbols: ResolvedSymbols): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	const { all, origins } = symbols;
	for (const property of all.properties) {
		const item = new vscode.CompletionItem(property.name, vscode.CompletionItemKind.Variable);
		item.detail = `${property.type} — "${property.label}"`;
		item.documentation = propertyDoc(property);
		item.sortText = `0_${property.name}`;
		items.push(item);
	}
	for (const fn of all.functions) {
		const item = new vscode.CompletionItem(fn.name, vscode.CompletionItemKind.Function);
		item.detail = `${fn.returnType} ${fn.name}(${fn.params})`;
		item.documentation = functionDoc(fn, origins.get(fn.name));
		item.insertText = buildCallSnippet(fn.name, parseArgNamesFromSignature(`${fn.name}(${fn.params})`), false);
		item.sortText = `0_${fn.name}`;
		items.push(item);
	}
	for (const macro of all.macros) {
		const item = new vscode.CompletionItem(macro.name, macro.params !== undefined ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Constant);
		item.detail = `#define ${macro.name}${macro.params !== undefined ? `(${macro.params})` : ''} ${macro.value}`.trimEnd();
		item.documentation = macroDoc(macro, origins.get(macro.name));
		item.sortText = `0_${macro.name}`;
		items.push(item);
	}
	for (const struct of all.structs) {
		const item = new vscode.CompletionItem(struct.name, vscode.CompletionItemKind.Struct);
		item.detail = `struct ${struct.name}`;
		item.documentation = structDoc(struct, origins.get(struct.name));
		item.sortText = `0_${struct.name}`;
		items.push(item);
	}
	return items;
}

function shaderLabStatementItems(stack: string[]): vscode.CompletionItem[] {
	const top = stack[stack.length - 1] as 'Shader' | 'SubShader' | 'Pass';
	return SHADERLAB_STATEMENTS.filter((entry) => entry.scopes.includes(top)).map(({ name, snippet, doc }) => {
		const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
		item.insertText = new vscode.SnippetString(snippet ?? name);
		item.detail = 'ShaderLab';
		item.documentation = entryDoc(doc);
		return item;
	});
}

function propertyTypeItems(
	document: vscode.TextDocument,
	position: vscode.Position,
	prefix: string,
): vscode.CompletionItem[] | undefined {
	if (!PROPERTY_TYPE_POSITION_PATTERN.test(prefix) || !isInsidePropertiesBlock(document, position)) {
		return undefined;
	}
	return PROPERTY_TYPE_SNIPPETS.map(({ label, insertAfterComma, doc }) => {
		const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.EnumMember);
		item.insertText = new vscode.SnippetString(insertAfterComma);
		item.detail = `ShaderLab property type: ${label}`;
		item.documentation = new vscode.MarkdownString(doc);
		return item;
	});
}

function propertyLineSnippetItems(document: vscode.TextDocument, position: vscode.Position, prefix: string): vscode.CompletionItem[] | undefined {
	if (prefix.trim() !== '' || !isInsidePropertiesBlock(document, position)) {
		return undefined;
	}
	return Object.entries(propertySnippetsData as Record<string, { prefix: string; body: string | string[]; description?: string }>)
		.filter(([name]) => name.startsWith('ShaderLab Property'))
		.map(([name, snippet]) => {
			const item = new vscode.CompletionItem(snippet.prefix, vscode.CompletionItemKind.Snippet);
			const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
			item.insertText = new vscode.SnippetString(body);
			item.detail = snippet.description ?? name;
			return item;
		});
}

async function includePathItems(document: vscode.TextDocument, prefix: string): Promise<vscode.CompletionItem[] | undefined> {
	const match = prefix.match(/#include\s+"([^"]*)$/);
	if (!match) {
		return undefined;
	}
	const partial = match[1];
	const lastSlash = Math.max(partial.lastIndexOf('/'), partial.lastIndexOf('\\'));
	const dirPart = lastSlash === -1 ? '' : partial.substring(0, lastSlash + 1);
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;

	let dirToList: string | undefined;
	if (dirPart) {
		const resolved = await resolveInclude(dirPart, document.uri.fsPath, workspaceFolder);
		dirToList = resolved;
		if (!dirToList && splitPackageInclude(dirPart)) {
			// Package path that doesn't resolve yet (e.g. only "Packages/" typed so far) — nothing to list.
			return [];
		}
	} else {
		dirToList = path.dirname(document.uri.fsPath);
	}

	if (!dirToList) {
		return [];
	}

	try {
		const entries = await fs.readdir(dirToList, { withFileTypes: true });
		return entries.map((entry) => {
			const kind = entry.isDirectory() ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File;
			const item = new vscode.CompletionItem(entry.name, kind);
			if (entry.isDirectory()) {
				item.insertText = `${entry.name}/`;
				item.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger completion' };
			}
			return item;
		});
	} catch {
		return [];
	}
}

export class ShaderLabCompletionProvider implements vscode.CompletionItemProvider {
	private readonly functionItems = buildFunctionItems();
	private readonly keywordItems = buildKeywordItems();
	private readonly urpBuiltinItems = buildUrpBuiltinItems();

	async provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): Promise<vscode.CompletionItem[] | undefined> {
		if (!isSuggestEnabled()) {
			return undefined;
		}

		const prefix = maskedPrefix(document, position);
		const rawPrefix = document.lineAt(position.line).text.substring(0, position.character);

		const includeItems = await includePathItems(document, prefix);
		if (includeItems) {
			return includeItems;
		}

		const stack = getBlockStack(document, position);
		let symbolsPromise: Promise<ResolvedSymbols> | undefined;
		const symbols = () => (symbolsPromise ??= getResolvedSymbols(document));

		const tagCompletions = tagItems(rawPrefix, stack);
		if (tagCompletions) {
			return tagCompletions;
		}

		const passStateItems = passStateValueItems(prefix, stack);
		if (passStateItems) {
			return passStateItems;
		}

		const pragmaCompletions = await pragmaItems(prefix, symbols);
		if (pragmaCompletions) {
			return pragmaCompletions;
		}

		const insideProperties = stack[stack.length - 1] === 'Properties';
		if (insideProperties) {
			const attributeCompletions = propertyAttributeItems(prefix);
			if (attributeCompletions) {
				return attributeCompletions;
			}
		}

		const propertyTypeCompletions = propertyTypeItems(document, position, prefix);
		if (propertyTypeCompletions) {
			return propertyTypeCompletions;
		}

		const propertyLineCompletions = propertyLineSnippetItems(document, position, prefix);
		if (propertyLineCompletions) {
			return propertyLineCompletions;
		}

		const resolved = await symbols();

		const members = memberItems(maskedTextBefore(document, position), resolved);
		if (members) {
			return members;
		}

		if (isPreprocessorConditionContext(prefix)) {
			const macros = resolved.all.macros.map((macro) => {
				const item = new vscode.CompletionItem(macro.name, vscode.CompletionItemKind.Constant);
				item.documentation = macroDoc(macro, resolved.origins.get(macro.name));
				item.sortText = `0_${macro.name}`;
				return item;
			});
			const knownMacros = this.urpBuiltinItems.filter((item) => item.kind === vscode.CompletionItemKind.Keyword);
			return [...symbolKeywordItems(resolved), ...macros, ...knownMacros];
		}

		if (insideProperties || stack[stack.length - 1] === 'Tags' || stack[stack.length - 1] === 'Stencil') {
			return stack[stack.length - 1] === 'Stencil'
				? Object.keys(STENCIL_STATEMENTS).concat(['Ref', 'ReadMask', 'WriteMask']).map((name) => new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword))
				: undefined;
		}

		const statements = isShaderLabScope(stack) ? shaderLabStatementItems(stack) : [];
		return [...userSymbolItems(resolved), ...statements, ...this.functionItems, ...this.keywordItems, ...this.urpBuiltinItems];
	}
}

export function registerCompletionProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			SHADERLAB_PRO_DOCUMENT_SELECTOR,
			new ShaderLabCompletionProvider(),
			'"',
			'/',
			'[',
			'.',
		),
	);
}
