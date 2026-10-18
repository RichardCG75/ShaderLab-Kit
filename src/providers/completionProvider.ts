// Completion for ShaderLab/HLSL files: generic HLSL intrinsics/semantics (ported data), curated
// Unity/URP built-ins, Pass-state enum values, and #include path completion. Gated by
// shaderlabKit.suggest.enable. HLSL/URP scope only — see shaderlab-domain skill.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import functionsData from '../data/functions.json';
import keywordsData from '../data/keywords.json';
import propertySnippetsData from '../../snippets/shaderlab-kit.json';
import { URP_BUILTINS } from '../data/urpBuiltins';
import { getSemanticDoc } from '../data/hlslSemantics';
import { maskLine } from '../utils/commentMask';
import { resolveInclude, splitPackageInclude } from '../unity/includeResolver';

export const SHADERLAB_PRO_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
	{ language: 'shaderlab' },
	{ language: 'hlsl' },
];

const PASS_STATE_VALUES: Record<string, string[]> = {
	Blend: ['One', 'Zero', 'SrcAlpha', 'OneMinusSrcAlpha', 'DstAlpha', 'OneMinusDstAlpha', 'SrcColor', 'OneMinusSrcColor', 'DstColor', 'OneMinusDstColor'],
	ZWrite: ['On', 'Off'],
	ZTest: ['Less', 'Greater', 'LEqual', 'GEqual', 'Equal', 'NotEqual', 'Always'],
	Cull: ['Back', 'Front', 'Off'],
};

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
 * Whether `position` is lexically inside an unclosed `Properties { ... }` block. Scans the
 * comment/string-masked text from document start to `position`, tracking a brace-depth stack
 * labeled by the identifier preceding each `{` (e.g. "Properties", "SubShader", "Pass").
 */
export function isInsidePropertiesBlock(document: vscode.TextDocument, position: vscode.Position): boolean {
	const text = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
	const masked = text.split('\n').map((line) => maskLine(line).masked).join('\n');
	const stack: string[] = [];
	for (let i = 0; i < masked.length; i++) {
		const ch = masked[i];
		if (ch === '{') {
			let j = i - 1;
			while (j >= 0 && /\s/.test(masked[j])) {
				j--;
			}
			const end = j + 1;
			while (j >= 0 && /\w/.test(masked[j])) {
				j--;
			}
			stack.push(masked.slice(j + 1, end));
		} else if (ch === '}') {
			stack.pop();
		}
	}
	return stack.length > 0 && stack[stack.length - 1] === 'Properties';
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
				: vscode.CompletionItemKind.Constant;
		const item = new vscode.CompletionItem(builtin.name, kind);
		item.detail = builtin.detail;
		item.documentation = new vscode.MarkdownString(builtin.detail);

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

function passStateValueItems(prefix: string): vscode.CompletionItem[] | undefined {
	const match = prefix.match(/\b(Blend|ZWrite|ZTest|Cull)\s+[A-Za-z]*$/);
	if (!match) {
		return undefined;
	}
	const values = PASS_STATE_VALUES[match[1]];
	return values.map((value) => new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember));
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
	return Object.entries(propertySnippetsData as Record<string, { prefix: string; body: string | string[]; description?: string }>).map(
		([name, snippet]) => {
			const item = new vscode.CompletionItem(snippet.prefix, vscode.CompletionItemKind.Snippet);
			const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
			item.insertText = new vscode.SnippetString(body);
			item.detail = snippet.description ?? name;
			return item;
		},
	);
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

		const includeItems = await includePathItems(document, prefix);
		if (includeItems) {
			return includeItems;
		}

		const passStateItems = passStateValueItems(prefix);
		if (passStateItems) {
			return passStateItems;
		}

		const propertyTypeCompletions = propertyTypeItems(document, position, prefix);
		if (propertyTypeCompletions) {
			return propertyTypeCompletions;
		}

		const propertyLineCompletions = propertyLineSnippetItems(document, position, prefix);
		if (propertyLineCompletions) {
			return [...propertyLineCompletions, ...this.functionItems, ...this.keywordItems, ...this.urpBuiltinItems];
		}

		return [...this.functionItems, ...this.keywordItems, ...this.urpBuiltinItems];
	}
}

export function registerCompletionProvider(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			SHADERLAB_PRO_DOCUMENT_SELECTOR,
			new ShaderLabCompletionProvider(),
			'"',
			'/',
		),
	);
}
