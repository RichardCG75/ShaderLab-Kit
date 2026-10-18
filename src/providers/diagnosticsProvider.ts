// Diagnostics for ShaderLab/HLSL files. Deliberately scoped to checks that don't need a real parser
// and won't produce noisy false positives: unbalanced brackets, unsupported legacy-Cg constructs,
// likely-misspelled Unity/URP built-ins (near-miss only, never fires on genuinely unknown
// identifiers), and wrong argument counts for known HLSL intrinsics on single-line call sites.
// Missing-semicolon detection is explicitly out of scope — unreliable without a real parser.
// Gated by shaderlabKit.analysis.enable. HLSL/URP scope only — see shaderlab-domain skill.

import * as vscode from 'vscode';
import functionsData from '../data/functions.json';
import { URP_BUILTINS } from '../data/urpBuiltins';
import { maskLine } from '../utils/commentMask';
import { EXCLUDED_ENTRYPOINT_NAMES, EXCLUDED_LEGACY_KEYWORDS, SHADERLAB_PRO_DOCUMENT_SELECTOR } from './completionProvider';

export function isAnalysisEnabled(): boolean {
	return vscode.workspace.getConfiguration('shaderlabKit.analysis').get<boolean>('enable', true);
}

export interface RawDiagnostic {
	line: number;
	startChar: number;
	endChar: number;
	message: string;
	severity: vscode.DiagnosticSeverity;
}

// --- Check 2 data: legacy Cg constructs that are out of scope for this HLSL/URP-only extension. ---
// EXCLUDED_LEGACY_KEYWORDS covers the block keywords (CGPROGRAM/CGINCLUDE/ENDCG/GLSL*); these are
// Cg-era texture macros that never made it into the ported data (shadeview's values.json, which had
// them, was deliberately not ported) but are common enough in the wild to warn about directly.
const LEGACY_MACRO_NAMES = ['UNITY_DECLARE_TEX2D', 'UNITY_DECLARE_TEX2D_NOSAMPLER', 'UNITY_SAMPLE_TEX2D', 'UNITY_SAMPLE_TEX2D_SAMPLER', 'UNITY_DECLARE_TEX3D', 'UNITY_DECLARE_TEXCUBE'];
const LEGACY_CONSTRUCT_NAMES = [...EXCLUDED_LEGACY_KEYWORDS, ...LEGACY_MACRO_NAMES];
const legacyConstructRegex = new RegExp(`\\b(${LEGACY_CONSTRUCT_NAMES.join('|')})\\b`, 'g');

// --- Check 3 data: known Unity/URP built-in names, split by "shape" so a misspelled UNITY_ macro
// is only ever compared against other UNITY_ macros, and a misspelled URP function call only
// against other function names — keeps false-positive-prone cross-shape matches off the table. ---
const KNOWN_UNITY_MACRO_NAMES = URP_BUILTINS.filter((b) => b.kind !== 'function' && b.name.startsWith('UNITY_')).map((b) => b.name);
const KNOWN_URP_FUNCTION_NAMES = URP_BUILTINS.filter((b) => b.kind === 'function').map((b) => b.name);
const ALL_KNOWN_BUILTIN_NAMES = new Set(URP_BUILTINS.map((b) => b.name));

const UNITY_MACRO_SHAPE = /^UNITY_[A-Z0-9_]{6,}$/;
const URP_FUNCTION_SHAPE = /^[A-Z][A-Za-z0-9]{5,}$/;

/** Edit distance threshold for the "did you mean X?" check (check 3). Names here run 8–20 chars
 * (e.g. UNITY_MATRIX_M, UniversalFragmentPBR); distance <= 2 catches typical single/double-char
 * typos, transpositions, and missing chars while still requiring most of the name to match, so it
 * won't fire on an unrelated custom identifier that merely happens to be a similar length. */
const MAX_EDIT_DISTANCE = 2;

function levenshtein(a: string, b: string): number {
	const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = 0; i <= a.length; i++) { dp[i][0] = i; }
	for (let j = 0; j <= b.length; j++) { dp[0][j] = j; }
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			dp[i][j] = a[i - 1] === b[j - 1]
				? dp[i - 1][j - 1]
				: 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
		}
	}
	return dp[a.length][b.length];
}

function closestMatch(token: string, candidates: string[]): { name: string; distance: number } | undefined {
	let best: { name: string; distance: number } | undefined;
	for (const candidate of candidates) {
		if (Math.abs(candidate.length - token.length) > MAX_EDIT_DISTANCE) {
			continue;
		}
		const distance = levenshtein(token, candidate);
		if (distance > 0 && distance <= MAX_EDIT_DISTANCE && (!best || distance < best.distance)) {
			best = { name: candidate, distance };
		}
	}
	return best;
}

// --- Check 4 data: valid argument counts per known HLSL intrinsic, parsed once from the Synopsis
// overload signatures already in functions.json (e.g. "float4 lerp(float4 a, float4 b, float4 w)"
// -> 3). All 228 entries parse cleanly against this format; if a future data update adds an entry
// that doesn't match, it's silently skipped (no arg-count check for it) rather than guessed at. ---
const FUNCTION_ARG_COUNTS = buildFunctionArgCounts();

function buildFunctionArgCounts(): Map<string, Set<number>> {
	const map = new Map<string, Set<number>>();
	const items = functionsData.Items as Record<string, { Synopsis?: string[] }>;
	for (const [name, entry] of Object.entries(items)) {
		if (EXCLUDED_ENTRYPOINT_NAMES.has(name)) {
			continue;
		}
		const counts = new Set<number>();
		for (const sig of entry.Synopsis ?? []) {
			const match = sig.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*$/);
			if (!match) {
				continue;
			}
			const argsStr = match[2].trim();
			counts.add(argsStr === '' ? 0 : argsStr.split(',').length);
		}
		if (counts.size > 0) {
			map.set(name, counts);
		}
	}
	return map;
}

const knownFunctionNames = [...FUNCTION_ARG_COUNTS.keys()];
const functionCallRegex = knownFunctionNames.length > 0
	? new RegExp(`(?<![A-Za-z0-9_])(${knownFunctionNames.map(escapeRegex).join('|')})(?![A-Za-z0-9_])\\s*\\(`, 'g')
	: undefined;

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds the matching ')' for the '(' at openIndex within a single line, and the top-level
 * (depth-0 relative to this call) argument count. Returns undefined if unclosed on this line —
 * multi-line call sites are intentionally not handled (skip rather than guess, per scope). */
function parseCallArgCount(line: string, openIndex: number): number | undefined {
	let depth = 1;
	let argCount = 1;
	for (let i = openIndex + 1; i < line.length; i++) {
		const ch = line[i];
		if (ch === '(') {
			depth++;
		} else if (ch === ')') {
			depth--;
			if (depth === 0) {
				const inner = line.substring(openIndex + 1, i).trim();
				return inner === '' ? 0 : argCount;
			}
		} else if (ch === ',' && depth === 1) {
			argCount++;
		}
	}
	return undefined;
}

function collectLocalDefines(maskedLines: string[]): Set<string> {
	const defined = new Set<string>();
	const defineRegex = /#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)/;
	for (const line of maskedLines) {
		const match = line.match(defineRegex);
		if (match) {
			defined.add(match[1]);
		}
	}
	return defined;
}

function checkBrackets(maskedLines: string[]): RawDiagnostic[] {
	const diagnostics: RawDiagnostic[] = [];
	const OPEN_TO_CLOSE: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
	const CLOSE_TO_OPEN: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
	const stack: { ch: string; line: number; char: number }[] = [];

	for (let line = 0; line < maskedLines.length; line++) {
		const text = maskedLines[line];
		for (let char = 0; char < text.length; char++) {
			const ch = text[char];
			if (OPEN_TO_CLOSE[ch]) {
				stack.push({ ch, line, char });
			} else if (CLOSE_TO_OPEN[ch]) {
				const top = stack[stack.length - 1];
				if (top && top.ch === CLOSE_TO_OPEN[ch]) {
					stack.pop();
				} else {
					diagnostics.push({
						line, startChar: char, endChar: char + 1,
						message: `Unexpected closing '${ch}' with no matching '${CLOSE_TO_OPEN[ch]}'.`,
						severity: vscode.DiagnosticSeverity.Error,
					});
				}
			}
		}
	}

	for (const unclosed of stack) {
		diagnostics.push({
			line: unclosed.line, startChar: unclosed.char, endChar: unclosed.char + 1,
			message: `Unclosed '${unclosed.ch}' — no matching '${OPEN_TO_CLOSE[unclosed.ch]}' found.`,
			severity: vscode.DiagnosticSeverity.Error,
		});
	}
	return diagnostics;
}

function checkLegacyConstructs(maskedLines: string[]): RawDiagnostic[] {
	const diagnostics: RawDiagnostic[] = [];
	if (LEGACY_CONSTRUCT_NAMES.length === 0) {
		return diagnostics;
	}
	for (let line = 0; line < maskedLines.length; line++) {
		legacyConstructRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = legacyConstructRegex.exec(maskedLines[line]))) {
			diagnostics.push({
				line, startChar: match.index, endChar: match.index + match[0].length,
				message: `'${match[0]}' is a legacy Cg-pipeline construct and isn't supported — this project targets HLSLPROGRAM/URP only.`,
				severity: vscode.DiagnosticSeverity.Warning,
			});
		}
	}
	return diagnostics;
}

function checkMisspelledBuiltins(maskedLines: string[], locallyDefined: Set<string>): RawDiagnostic[] {
	const diagnostics: RawDiagnostic[] = [];
	const identifierRegex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

	for (let line = 0; line < maskedLines.length; line++) {
		const text = maskedLines[line];
		identifierRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = identifierRegex.exec(text))) {
			const token = match[0];
			if (ALL_KNOWN_BUILTIN_NAMES.has(token) || locallyDefined.has(token)) {
				continue;
			}

			let candidates: string[] | undefined;
			if (UNITY_MACRO_SHAPE.test(token)) {
				candidates = KNOWN_UNITY_MACRO_NAMES;
			} else if (URP_FUNCTION_SHAPE.test(token) && text.slice(identifierRegex.lastIndex).match(/^\s*\(/)) {
				candidates = KNOWN_URP_FUNCTION_NAMES;
			}
			if (!candidates) {
				continue;
			}

			const best = closestMatch(token, candidates);
			if (best) {
				diagnostics.push({
					line, startChar: match.index, endChar: match.index + token.length,
					message: `Unrecognized Unity/URP identifier '${token}' — did you mean '${best.name}'?`,
					severity: vscode.DiagnosticSeverity.Warning,
				});
			}
		}
	}
	return diagnostics;
}

function checkArgumentCounts(maskedLines: string[]): RawDiagnostic[] {
	const diagnostics: RawDiagnostic[] = [];
	if (!functionCallRegex) {
		return diagnostics;
	}
	for (let line = 0; line < maskedLines.length; line++) {
		const text = maskedLines[line];
		functionCallRegex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = functionCallRegex.exec(text))) {
			const name = match[1];
			const openIndex = match.index + match[0].length - 1;
			const argCount = parseCallArgCount(text, openIndex);
			if (argCount === undefined) {
				continue; // Unclosed on this line (multi-line call) — skip rather than guess.
			}
			const validCounts = FUNCTION_ARG_COUNTS.get(name);
			if (validCounts && !validCounts.has(argCount)) {
				const expected = [...validCounts].sort((a, b) => a - b).join(' or ');
				diagnostics.push({
					line, startChar: match.index, endChar: match.index + name.length,
					message: `'${name}' expects ${expected} argument(s), got ${argCount}.`,
					severity: vscode.DiagnosticSeverity.Error,
				});
			}
		}
	}
	return diagnostics;
}

/** Pure diagnostic computation over raw document text — exported for testing without a live
 * vscode.TextDocument. Splits the same way commentMask.maskDocument does, then masks per line
 * (tracking block-comment state across lines) so positions map 1:1 onto the original lines. */
export function computeDiagnosticsForText(text: string): RawDiagnostic[] {
	const rawLines = text.split(/\r\n|\r|\n/);
	const maskedLines: string[] = [];
	let inBlockComment = false;
	for (const rawLine of rawLines) {
		const { masked, endsInBlockComment } = maskLine(rawLine, inBlockComment);
		maskedLines.push(masked);
		inBlockComment = endsInBlockComment;
	}

	const locallyDefined = collectLocalDefines(maskedLines);

	return [
		...checkBrackets(maskedLines),
		...checkLegacyConstructs(maskedLines),
		...checkMisspelledBuiltins(maskedLines, locallyDefined),
		...checkArgumentCounts(maskedLines),
	];
}

function toVscodeDiagnostic(raw: RawDiagnostic): vscode.Diagnostic {
	const range = new vscode.Range(raw.line, raw.startChar, raw.line, raw.endChar);
	const diagnostic = new vscode.Diagnostic(range, raw.message, raw.severity);
	diagnostic.source = 'shaderlab-kit';
	return diagnostic;
}

const DEBOUNCE_MS = 300;

export function registerDiagnosticsProvider(context: vscode.ExtensionContext): void {
	const collection = vscode.languages.createDiagnosticCollection('shaderlab-kit');
	context.subscriptions.push(collection);

	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function scheduleUpdate(document: vscode.TextDocument): void {
		if (!vscode.languages.match(SHADERLAB_PRO_DOCUMENT_SELECTOR, document)) {
			return;
		}
		const key = document.uri.toString();
		const existing = timers.get(key);
		if (existing) {
			clearTimeout(existing);
		}
		timers.set(key, setTimeout(() => {
			timers.delete(key);
			updateNow(document);
		}, DEBOUNCE_MS));
	}

	function updateNow(document: vscode.TextDocument): void {
		if (!isAnalysisEnabled()) {
			collection.delete(document.uri);
			return;
		}
		const diagnostics = computeDiagnosticsForText(document.getText()).map(toVscodeDiagnostic);
		collection.set(document.uri, diagnostics);
	}

	for (const document of vscode.workspace.textDocuments) {
		scheduleUpdate(document);
	}

	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(scheduleUpdate),
		vscode.workspace.onDidChangeTextDocument((e) => scheduleUpdate(e.document)),
		vscode.workspace.onDidCloseTextDocument((document) => {
			const key = document.uri.toString();
			const existing = timers.get(key);
			if (existing) {
				clearTimeout(existing);
				timers.delete(key);
			}
			collection.delete(document.uri);
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('shaderlabKit.analysis')) {
				for (const document of vscode.workspace.textDocuments) {
					scheduleUpdate(document);
				}
			}
		}),
	);
}
