// Line-based re-indentation formatter for ShaderLab/HLSL files. Not a full AST pretty-printer —
// recomputes indentation from brace/paren nesting depth (masking comments/strings first) and
// applies the shaderlabKit.formatting.* settings. Gated by shaderlabKit.formatting.enable.

import * as vscode from 'vscode';
import { maskLine } from '../utils/commentMask';
import { SHADERLAB_PRO_DOCUMENT_SELECTOR } from './completionProvider';

export type PreprocessorStyle = 'Hierarchy' | 'Follow Code' | 'Flush Left' | 'None';

export interface FormatSettings {
	enable: boolean;
	bracestyle: boolean;
	tagsSingleline: boolean;
	cbuffer: boolean;
	preprocessorStyle: PreprocessorStyle;
	indentIncludeGuard: boolean;
	indentUnit: string;
}

export function isFormattingEnabled(): boolean {
	return vscode.workspace.getConfiguration('shaderlabKit.formatting').get<boolean>('enable', true);
}

export function getFormatSettings(options: vscode.FormattingOptions): FormatSettings {
	const config = vscode.workspace.getConfiguration('shaderlabKit.formatting');
	return {
		enable: config.get<boolean>('enable', true),
		bracestyle: config.get<boolean>('bracestyle', true),
		tagsSingleline: config.get<boolean>('tags.singleline', true),
		cbuffer: config.get<boolean>('cbuffer', true),
		preprocessorStyle: resolvePreprocessorStyle(config),
		indentIncludeGuard: config.get<boolean>('indentIncludeGuard', false),
		indentUnit: options.insertSpaces ? ' '.repeat(options.tabSize) : '\t',
	};
}

/**
 * `preprocessorStyle` replaces the older `alignMacros` + `indentWithinPreprocessor` pair. When the
 * new setting hasn't been set explicitly but a legacy one has, translate the legacy values so
 * existing user configs keep working.
 */
function resolvePreprocessorStyle(config: vscode.WorkspaceConfiguration): PreprocessorStyle {
	const isSet = (key: string): boolean => {
		const info = config.inspect(key);
		return (
			info?.globalValue !== undefined ||
			info?.workspaceValue !== undefined ||
			info?.workspaceFolderValue !== undefined
		);
	};
	if (isSet('preprocessorStyle') || !(isSet('alignMacros') || isSet('indentWithinPreprocessor'))) {
		return config.get<PreprocessorStyle>('preprocessorStyle', 'Hierarchy');
	}
	const align = config.get<string>('alignMacros', 'Hierarchy Indentation');
	if (align === 'None') {
		return 'None';
	}
	if (align === 'Align Left') {
		return 'Flush Left';
	}
	return config.get<boolean>('indentWithinPreprocessor', true) ? 'Hierarchy' : 'Follow Code';
}

/** `#ifndef NAME` directly followed by `#define NAME`: a header include guard, not real conditional code. */
function isIncludeGuardOpen(maskedTrimmed: string, nextTrimmed: string | undefined): boolean {
	const guard = /^#\s*ifndef\s+(\w+)\s*$/.exec(maskedTrimmed);
	const define = nextTrimmed === undefined ? null : /^#\s*define\s+(\w+)\s*$/.exec(nextTrimmed);
	return guard !== null && define !== null && define[1] === guard[1];
}

/** Does this masked, trimmed line open a new `#if`-family conditional block? */
function opensPreprocessorBlock(maskedTrimmed: string): boolean {
	return /^#\s*(if|ifdef|ifndef)\b/.test(maskedTrimmed);
}

/** Does this masked, trimmed line close the innermost `#if`-family conditional block? */
function closesPreprocessorBlock(maskedTrimmed: string): boolean {
	return /^#\s*endif\b/.test(maskedTrimmed);
}

/**
 * Collapses `Tags { ... }` blocks (single- or multi-line) to one line, normalizing the
 * `"key"="value"` pairs inside. Pure text transform, runs before everything else.
 */
function collapseTagsBlocks(text: string): string {
	return text.replace(/\bTags\s*\{([\s\S]*?)\}/g, (_match, inner: string) => {
		const pairs: string[] = inner.match(/"[^"]*"\s*=\s*"[^"]*"/g) ?? [];
		return pairs.length ? `Tags { ${pairs.join(' ')} }` : 'Tags { }';
	});
}

/**
 * Enforces Allman-style brace placement (opening brace on its own line) — the convention used by
 * Unity's own built-in shader templates (`Shader "..."` / `Properties` / `SubShader` / `Pass` are
 * all written with the brace on the following line). Applied uniformly to every brace, including
 * HLSL function/control-flow braces, for one consistent house style. Only splits a line that
 * ends with a lone, unmasked `{` (so `Tags { ... }`, `CBUFFER_START(Name)`, and inline `= "white"
 * {}` default-texture values are left untouched — none of them end the line on a bare `{`).
 */
function reflowToAllman(text: string): string {
	const lines = text.split(/\r\n|\r|\n/);
	const out: string[] = [];
	let inBlockComment = false;

	for (const rawLine of lines) {
		const trimmed = rawLine.trimEnd();
		const { masked, endsInBlockComment } = maskLine(rawLine, inBlockComment);
		inBlockComment = endsInBlockComment;
		const maskedTrimmed = masked.trimEnd();

		const endsInLoneBrace =
			maskedTrimmed.endsWith('{') &&
			trimmed.endsWith('{') &&
			!maskedTrimmed.endsWith('{}') &&
			maskedTrimmed.trim() !== '{';

		if (endsInLoneBrace) {
			const before = trimmed.slice(0, trimmed.length - 1).trimEnd();
			if (before.length > 0) {
				out.push(before);
				out.push('{');
				continue;
			}
		}
		out.push(rawLine);
	}

	return out.join('\n');
}

/**
 * Pure string -> string formatter: recomputes every line's indentation from brace/paren nesting
 * depth (parens are tracked too, so a multi-line function signature/argument list indents its
 * continuation lines one level deeper). `cbuffer` additionally treats the SRP
 * `CBUFFER_START(...)` / `CBUFFER_END` macro pair as a pseudo brace pair, since URP shaders use it
 * in place of a literal `{`/`}` for the per-material constant buffer.
 * `preprocessorStyle` controls how `#`-directive lines and the code inside `#if` blocks indent:
 *   - "Hierarchy": directives sit at the level of the surrounding code and the body of each
 *     `#if`/`#ifdef`/`#ifndef` is one level deeper per nesting level (clang-format style).
 *     `#else`/`#elif` are siblings of their `#if`, so both branches indent identically.
 *   - "Follow Code": directives sit at the surrounding code's level; bodies get no extra indent.
 *   - "Flush Left": directives at column 0; bodies get no extra indent.
 *   - "None": directive lines are left untouched; bodies get no extra indent.
 * A header include guard (`#ifndef X` + `#define X`) doesn't count as a nesting level unless
 * `indentIncludeGuard` is on.
 */
export function formatShaderLabSource(text: string, settings: FormatSettings): string {
	if (!settings.enable) {
		return text;
	}

	let working = settings.tagsSingleline ? collapseTagsBlocks(text) : text;
	working = settings.bracestyle ? reflowToAllman(working) : working;

	const lines = working.split(/\r\n|\r|\n/);
	const out: string[] = [];

	let depth = 0;
	// One entry per open `#if`-family block: does it contribute an indent level?
	const ppStack: boolean[] = [];
	let ppDepth = 0;
	let inBlockComment = false;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const rawLine = lines[lineIndex];
		const trimmed = rawLine.trim();
		const { masked, endsInBlockComment } = maskLine(rawLine, inBlockComment);
		inBlockComment = endsInBlockComment;
		const maskedTrimmed = masked.trim();

		if (trimmed.length === 0) {
			out.push('');
			continue;
		}

		const isPreprocessor = /^#/.test(trimmed);
		const isCbufferStart = settings.cbuffer && /^CBUFFER_START\b/.test(maskedTrimmed);
		const isCbufferEnd = settings.cbuffer && /^CBUFFER_END\b/.test(maskedTrimmed);

		let leadingClosers = 0;
		if (isCbufferEnd) {
			leadingClosers = 1;
		} else {
			let i = 0;
			while (i < maskedTrimmed.length && (maskedTrimmed[i] === '}' || maskedTrimmed[i] === ')')) {
				leadingClosers++;
				i++;
			}
		}
		const lineDepth = Math.max(0, depth - leadingClosers);
		const style = settings.preprocessorStyle;
		const continuesBlock = /^#\s*(else|elif|elifdef|elifndef|endif)\b/.test(maskedTrimmed);
		// A directive sits at its enclosing block's level, so `#elif`/`#else`/`#endif` use the depth
		// outside the block they belong to; the body lines inside use the full depth.
		const ppExtra =
			style !== 'Hierarchy' ? 0 : isPreprocessor && continuesBlock ? Math.max(0, ppDepth - 1) : ppDepth;

		let indent: string | undefined;
		if (isPreprocessor && style === 'None') {
			indent = undefined;
		} else if (isPreprocessor && style === 'Flush Left') {
			indent = '';
		} else {
			indent = settings.indentUnit.repeat(lineDepth + ppExtra);
		}

		out.push(indent === undefined ? rawLine : indent + trimmed);

		if (opensPreprocessorBlock(maskedTrimmed)) {
			const nextTrimmed = lines.slice(lineIndex + 1).find((l) => l.trim().length > 0)?.trim();
			const counts = settings.indentIncludeGuard || !isIncludeGuardOpen(maskedTrimmed, nextTrimmed);
			ppStack.push(counts);
			if (counts) {
				ppDepth++;
			}
		} else if (closesPreprocessorBlock(maskedTrimmed) && ppStack.length > 0) {
			if (ppStack.pop()) {
				ppDepth--;
			}
		}

		let delta = 0;
		for (const ch of maskedTrimmed) {
			if (ch === '{' || ch === '(') {
				delta++;
			} else if (ch === '}' || ch === ')') {
				delta--;
			}
		}
		if (isCbufferStart) {
			delta += 1;
		}
		if (isCbufferEnd) {
			delta -= 1;
		}
		depth = Math.max(0, depth + delta);
	}

	return out.join('\n');
}

export class ShaderLabFormattingProvider
	implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider
{
	provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions): vscode.TextEdit[] {
		if (!isFormattingEnabled()) {
			return [];
		}
		const text = document.getText();
		const formatted = formatShaderLabSource(text, getFormatSettings(options));
		const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
		return [vscode.TextEdit.replace(fullRange, formatted)];
	}

	provideDocumentRangeFormattingEdits(
		document: vscode.TextDocument,
		_range: vscode.Range,
		options: vscode.FormattingOptions,
	): vscode.TextEdit[] {
		// Brace-style reflow can change the document's line count, which makes mapping a partial
		// range back onto the reformatted output unsafe without a real diff. Simplification for
		// this pass: range formatting reformats the whole document, same as full-document
		// formatting — correct, if broader than the requested selection.
		return this.provideDocumentFormattingEdits(document, options);
	}
}

export function registerFormattingProvider(context: vscode.ExtensionContext): void {
	const provider = new ShaderLabFormattingProvider();
	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(SHADERLAB_PRO_DOCUMENT_SELECTOR, provider),
		vscode.languages.registerDocumentRangeFormattingEditProvider(SHADERLAB_PRO_DOCUMENT_SELECTOR, provider),
	);
}
