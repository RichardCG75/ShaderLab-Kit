// Line-based re-indentation formatter for ShaderLab/HLSL files. Not a full AST pretty-printer —
// recomputes indentation from brace/paren nesting depth (masking comments/strings first) and
// applies the shaderlabKit.formatting.* settings. Gated by shaderlabKit.formatting.enable.

import * as vscode from 'vscode';
import { maskLine } from '../utils/commentMask';
import { SHADERLAB_PRO_DOCUMENT_SELECTOR } from './completionProvider';

export type AlignMacrosMode = 'None' | 'Hierarchy Indentation' | 'Align Left' | 'Align With Code';

export interface FormatSettings {
	enable: boolean;
	bracestyle: boolean;
	tagsSingleline: boolean;
	cbuffer: boolean;
	alignMacros: AlignMacrosMode;
	indentWithinPreprocessor: boolean;
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
		alignMacros: config.get<AlignMacrosMode>('alignMacros', 'Hierarchy Indentation'),
		indentWithinPreprocessor: config.get<boolean>('indentWithinPreprocessor', true),
		indentUnit: options.insertSpaces ? ' '.repeat(options.tabSize) : '\t',
	};
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
 * in place of a literal `{`/`}` for the per-material constant buffer. `alignMacros` controls only
 * preprocessor-directive line indentation:
 *   - "None": directive lines are left completely untouched (no reindentation at all).
 *   - "Align Left": forced to column 0.
 *   - "Hierarchy Indentation" / "Align With Code": indented to match the surrounding code's brace
 *     depth. No meaningful distinction exists between these two for a line-based (non-AST)
 *     formatter — both mean "match the code around it" — so they're treated identically.
 *
 * `indentWithinPreprocessor` is a separate, independent nesting axis: when enabled, lines of CODE
 * between a `#if`/`#ifdef`/`#ifndef` and its matching `#endif` are indented one extra level per
 * level of preprocessor-conditional nesting, on top of their brace/paren depth — the same
 * convention clang-format and most C-family tooling use, so macro bodies read naturally instead of
 * sitting flush with the directives around them. `#else`/`#elif` don't change the nesting count
 * (they're siblings of the `#if` that opened the block, not a new level), so both branches of a
 * conditional indent their bodies identically. Per the setting's scope, only body lines gain this
 * extra indent — the `#if`/`#else`/`#endif` directive lines' own placement is governed solely by
 * `alignMacros`, unchanged by this setting.
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
	let ppDepth = 0;
	let inBlockComment = false;

	for (const rawLine of lines) {
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
		// Only non-preprocessor lines (the code *between* directives) pick up the extra
		// preprocessor-nesting indent; the directive lines themselves are governed by alignMacros.
		const ppExtra = settings.indentWithinPreprocessor && !isPreprocessor ? ppDepth : 0;

		let indent: string | undefined;
		if (isPreprocessor && settings.alignMacros === 'None') {
			indent = undefined;
		} else if (isPreprocessor && settings.alignMacros === 'Align Left') {
			indent = '';
		} else {
			indent = settings.indentUnit.repeat(lineDepth + ppExtra);
		}

		out.push(indent === undefined ? rawLine : indent + trimmed);

		if (opensPreprocessorBlock(maskedTrimmed)) {
			ppDepth++;
		} else if (closesPreprocessorBlock(maskedTrimmed)) {
			ppDepth = Math.max(0, ppDepth - 1);
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
