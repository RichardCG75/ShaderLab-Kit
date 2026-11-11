// Pure (vscode-free) extraction of the user-defined symbols in a ShaderLab/HLSL file: material
// properties (with attributes and the shader keywords they drive), #pragma keywords, #define macros,
// functions (with leading doc comments), structs and #include directives. Regex/brace-depth based, not
// a real parser — it favors never inventing symbols over finding every one. Used by completion, hover
// and diagnostics, and applied to the open file plus its project-local includes.

import { maskDocument } from '../utils/commentMask';
import { KEYWORD_PRAGMA_PATTERN } from '../data/shaderlabSyntax';

export interface ShaderProperty {
	name: string;
	label: string;
	/** e.g. `Float`, `Color`, `2D`, `Range(0, 1)`. */
	type: string;
	defaultValue: string;
	/** Attribute names with arguments, e.g. `KeywordEnum(A, B)`, `Toggle(_X)`, `HDR`. */
	attributes: string[];
	/** Keywords this property switches on, derived from `[Toggle]` / `[KeywordEnum]`. */
	drivenKeywords: string[];
	line: number;
}

export interface ShaderKeyword {
	name: string;
	/** Pragma kinds that declare it, e.g. `shader_feature_local`. */
	pragmas: string[];
	/** Property that drives it from the material Inspector, if any. */
	drivenBy?: string;
	line: number;
}

export interface ShaderMacro {
	name: string;
	params?: string;
	value: string;
	line: number;
}

export interface ShaderFunction {
	name: string;
	returnType: string;
	/** Raw parameter list text, whitespace-normalized. */
	params: string;
	doc?: string;
	/** `vertex` / `fragment` / … when named by a `#pragma`. */
	entryPointOf?: string;
	line: number;
}

export interface ShaderStructField {
	type: string;
	name: string;
	semantic?: string;
}

export interface ShaderStruct {
	name: string;
	fields: ShaderStructField[];
	line: number;
}

export interface ShaderPragmaKeywordLine {
	kind: string;
	keywords: string[];
	line: number;
}

export interface ShaderSymbols {
	properties: ShaderProperty[];
	keywords: ShaderKeyword[];
	pragmaKeywordLines: ShaderPragmaKeywordLine[];
	macros: ShaderMacro[];
	functions: ShaderFunction[];
	structs: ShaderStruct[];
	/** Raw include paths exactly as written. */
	includes: string[];
	/** Whether any `#pragma` line exists (false for plain include files). */
	hasPragmas: boolean;
}

const NON_TYPE_WORDS = new Set(['if', 'else', 'for', 'while', 'switch', 'return', 'do', 'case', 'struct', 'cbuffer', 'sizeof', 'typedef', 'define', 'defined']);

/** Unity turns a KeywordEnum value into a keyword suffix: upper-case, spaces to underscores. */
export function keywordEnumKeyword(propertyName: string, value: string): string {
	return `${propertyName.toUpperCase()}_${value.trim().toUpperCase().replace(/\s+/g, '_')}`;
}

function splitArgs(args: string): string[] {
	return args.split(',').map((a) => a.trim()).filter((a) => a.length > 0);
}

/** Splits `[A][B(x, y)]` (possibly several per line) into attribute strings. */
function parseAttributes(text: string): string[] {
	const attrs: string[] = [];
	const regex = /\[\s*([A-Za-z_]\w*(?:\s*\([^\]]*\))?)\s*\]/g;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(text))) {
		attrs.push(m[1].replace(/\s+/g, ' ').trim());
	}
	return attrs;
}

function drivenKeywords(propertyName: string, attributes: string[]): string[] {
	const keywords: string[] = [];
	for (const attr of attributes) {
		const m = attr.match(/^(\w+)\s*(?:\(([^)]*)\))?$/);
		if (!m) { continue; }
		const [, name, args] = m;
		if (name === 'Toggle' || name === 'ToggleOff') {
			const explicit = args ? splitArgs(args)[0] : undefined;
			keywords.push(explicit ?? `${propertyName.toUpperCase()}_${name === 'Toggle' ? 'ON' : 'OFF'}`);
		} else if (name === 'KeywordEnum' && args) {
			for (const value of splitArgs(args)) {
				keywords.push(keywordEnumKeyword(propertyName, value));
			}
		}
	}
	return keywords;
}

/** How many trailing characters of previous masked text callers should pass as `carry`. */
export const ADVANCE_CARRY_LENGTH = 300;

/** Label of the identifier (or quoted `Shader "name"` header) preceding a `{` at `index`. */
function blockLabelBefore(line: string, index: number): string {
	let j = index - 1;
	while (j >= 0 && /\s/.test(line[j])) { j--; }
	if (line[j] === '"') {
		// `Shader "Some/Name"` — the string content is masked, so walk back to the opening quote.
		j--;
		while (j >= 0 && line[j] !== '"') { j--; }
		j--;
		while (j >= 0 && /\s/.test(line[j])) { j--; }
	}
	const end = j + 1;
	while (j >= 0 && /\w/.test(line[j])) { j--; }
	return line.slice(j + 1, end);
}

/**
 * Advances a block-label stack over one comment/string-masked line. Labels are the identifier before
 * each `{` (`Shader`, `SubShader`, `Pass`, `Properties`, `Stencil`, `Tags`, a function name, …);
 * `HLSLPROGRAM`/`HLSLINCLUDE` … `ENDHLSL` push/pop a pseudo-block named `HLSL` so callers can tell
 * ShaderLab scope from HLSL code. Mutates and returns `stack`. See `ADVANCE_CARRY_LENGTH` for `carry`.
 */
export function advanceBlockStack(stack: string[], maskedLine: string, carry = ''): string[] {
	// `carry` is the tail of the preceding masked text so a `{` on its own line still finds the
	// label ("Properties" / `Shader "Name"`) written on the line above (Allman style).
	const text = carry + maskedLine;
	const tokenRegex = /[{}]|\b(?:HLSLPROGRAM|HLSLINCLUDE|ENDHLSL)\b/g;
	tokenRegex.lastIndex = carry.length;
	let m: RegExpExecArray | null;
	while ((m = tokenRegex.exec(text))) {
		const token = m[0];
		if (token === '{') {
			stack.push(blockLabelBefore(text, m.index));
		} else if (token === '}') {
			stack.pop();
		} else if (token === 'ENDHLSL') {
			const at = stack.lastIndexOf('HLSL');
			if (at !== -1) { stack.length = at; }
		} else {
			stack.push('HLSL');
		}
	}
	return stack;
}

/** Block-label stack at the start of every line, from comment/string-masked lines. */
function blockStackPerLine(maskedLines: string[]): string[][] {
	const stack: string[] = [];
	const perLine: string[][] = [];
	let carry = '';
	for (const line of maskedLines) {
		perLine.push([...stack]);
		advanceBlockStack(stack, line, carry);
		carry = (carry + line + '\n').slice(-ADVANCE_CARRY_LENGTH);
	}
	return perLine;
}

function leadingDocComment(rawLines: string[], lineIndex: number): string | undefined {
	const collected: string[] = [];
	let i = lineIndex - 1;
	// Block comment ending directly above.
	if (i >= 0 && /\*\/\s*$/.test(rawLines[i])) {
		while (i >= 0) {
			collected.unshift(rawLines[i]);
			if (/\/\*/.test(rawLines[i])) { break; }
			i--;
		}
		const text = collected.join('\n')
			.replace(/^\s*\/\*+!?/, '').replace(/\*+\/\s*$/, '')
			.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trimEnd()).join('\n').trim();
		return text || undefined;
	}
	while (i >= 0 && /^\s*\/\/+/.test(rawLines[i])) {
		collected.unshift(rawLines[i].replace(/^\s*\/\/+\s?/, '').trimEnd());
		i--;
	}
	const text = collected.join('\n').trim();
	return text || undefined;
}

export function extractSymbols(text: string): ShaderSymbols {
	const rawLines = text.split(/\r\n|\r|\n/);
	const maskedText = maskDocument(text);
	const maskedLines = maskedText.split('\n');
	const stacks = blockStackPerLine(maskedLines);

	const properties: ShaderProperty[] = [];
	const pragmaKeywordLines: ShaderPragmaKeywordLine[] = [];
	const macros: ShaderMacro[] = [];
	const includes: string[] = [];
	const pragmaEntryPoints = new Map<string, string>();
	let hasPragmas = false;

	let pendingAttributes: string[] = [];
	const propertyRegex = /^\s*((?:\[[^\]]*\]\s*)*)(_[A-Za-z0-9_]+)\s*\(\s*"([^"]*)"\s*,\s*(Range\s*\([^)]*\)|[A-Za-z0-9]+)\s*\)\s*=\s*(.*?)\s*(?:\/\/.*)?$/;
	const attributeOnlyRegex = /^\s*(?:\[[^\]]*\]\s*)+$/;

	for (let i = 0; i < rawLines.length; i++) {
		const raw = rawLines[i];
		const masked = maskedLines[i];
		const stack = stacks[i];

		if (stack[stack.length - 1] === 'Properties') {
			if (attributeOnlyRegex.test(masked)) {
				pendingAttributes.push(...parseAttributes(raw));
				continue;
			}
			const m = propertyRegex.exec(raw);
			if (m) {
				const name = m[2];
				const attributes = [...pendingAttributes, ...parseAttributes(m[1])];
				properties.push({
					name, label: m[3], type: m[4].replace(/\s+/g, ' '), defaultValue: m[5],
					attributes, drivenKeywords: drivenKeywords(name, attributes), line: i,
				});
				pendingAttributes = [];
				continue;
			}
			if (masked.trim() !== '') { pendingAttributes = []; }
			continue;
		}
		pendingAttributes = [];

		const define = masked.match(/^\s*#\s*define\s+([A-Za-z_]\w*)(\([^)]*\))?\s*(.*)$/);
		if (define) {
			if (macros.some((existing) => existing.name === define[1])) { continue; }
			macros.push({ name: define[1], params: define[2]?.slice(1, -1).trim(), value: define[3].trim(), line: i });
			continue;
		}

		const include = raw.match(/^\s*#\s*include\s+"([^"]*)"/);
		if (include && masked.match(/^\s*#\s*include/)) {
			includes.push(include[1]);
			continue;
		}

		const pragma = masked.match(/^\s*#\s*pragma\s+(\w+)\s*(.*)$/);
		if (pragma) {
			hasPragmas = true;
			const [, kind, args] = pragma;
			if (KEYWORD_PRAGMA_PATTERN.test(kind)) {
				const keywords = args.split(/\s+/).filter((k) => k.length > 0);
				pragmaKeywordLines.push({ kind, keywords, line: i });
			} else if (['vertex', 'fragment', 'geometry', 'hull', 'domain'].includes(kind)) {
				const fn = args.split(/\s+/)[0];
				if (fn) { pragmaEntryPoints.set(fn, kind); }
			}
		}
	}

	// Keywords: pragma-declared ones plus property-driven ones, merged by name.
	const keywordMap = new Map<string, ShaderKeyword>();
	for (const line of pragmaKeywordLines) {
		for (const name of line.keywords) {
			if (/^_+$/.test(name)) { continue; } // `_` / `__` are the "no keyword" placeholder
			const existing = keywordMap.get(name);
			if (existing) {
				if (!existing.pragmas.includes(line.kind)) { existing.pragmas.push(line.kind); }
			} else {
				keywordMap.set(name, { name, pragmas: [line.kind], line: line.line });
			}
		}
	}
	for (const property of properties) {
		for (const name of property.drivenKeywords) {
			const existing = keywordMap.get(name);
			if (existing) {
				existing.drivenBy = property.name;
			} else {
				keywordMap.set(name, { name, pragmas: [], drivenBy: property.name, line: property.line });
			}
		}
	}

	// Functions: `type name(params) [: SEMANTIC] {` — the brace requirement excludes calls and prototypes.
	const functions: ShaderFunction[] = [];
	const functionRegex = /^[ \t]*(?:(?:static|inline|const|precise|export)\s+)*([A-Za-z_]\w*(?:<[^>]*>)?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?::\s*\w+\s*)?(?=\n?\s*\{)/gm;
	let fm: RegExpExecArray | null;
	while ((fm = functionRegex.exec(maskedText))) {
		const [, returnType, name, params] = fm;
		if (NON_TYPE_WORDS.has(returnType) || NON_TYPE_WORDS.has(name)) { continue; }
		const nameOffset = fm.index + fm[0].indexOf(name, fm[0].indexOf(returnType) + returnType.length);
		const line = maskedText.slice(0, nameOffset).split('\n').length - 1;
		functions.push({
			name, returnType, params: params.replace(/\s+/g, ' ').trim(),
			doc: leadingDocComment(rawLines, line), entryPointOf: pragmaEntryPoints.get(name), line,
		});
	}

	// Structs.
	const structs: ShaderStruct[] = [];
	const structRegex = /\bstruct\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g;
	let sm: RegExpExecArray | null;
	while ((sm = structRegex.exec(maskedText))) {
		const fields: ShaderStructField[] = [];
		for (const chunk of sm[2].split(';')) {
			const fieldMatch = chunk.trim().match(/([A-Za-z_]\w*(?:<[^>]*>)?)\s+([A-Za-z_]\w*)(?:\s*\[[^\]]*\])?\s*(?::\s*([A-Za-z_]\w*))?$/);
			if (fieldMatch) {
				fields.push({ type: fieldMatch[1], name: fieldMatch[2], semantic: fieldMatch[3] });
			}
		}
		structs.push({ name: sm[1], fields, line: maskedText.slice(0, sm.index).split('\n').length - 1 });
	}

	return { properties, keywords: [...keywordMap.values()], pragmaKeywordLines, macros, functions, structs, includes, hasPragmas };
}

/** Merges symbol sets, with earlier entries (the open file) taking precedence over later ones (includes). */
export function mergeSymbols(primary: ShaderSymbols, others: ShaderSymbols[]): ShaderSymbols {
	const merged: ShaderSymbols = { ...primary };
	const byName = <T extends { name: string }>(a: T[], extra: T[][]): T[] => {
		const seen = new Set(a.map((x) => x.name));
		const out = [...a];
		for (const list of extra) {
			for (const item of list) {
				if (!seen.has(item.name)) { seen.add(item.name); out.push(item); }
			}
		}
		return out;
	};
	merged.macros = byName(primary.macros, others.map((o) => o.macros));
	merged.functions = byName(primary.functions, others.map((o) => o.functions));
	merged.structs = byName(primary.structs, others.map((o) => o.structs));
	// Keywords merge field-wise: a property in the main file may be declared by a #pragma in an include.
	const keywords = new Map<string, ShaderKeyword>();
	for (const list of [primary.keywords, ...others.map((o) => o.keywords)]) {
		for (const keyword of list) {
			const existing = keywords.get(keyword.name);
			if (!existing) {
				keywords.set(keyword.name, { ...keyword, pragmas: [...keyword.pragmas] });
			} else {
				for (const pragma of keyword.pragmas) {
					if (!existing.pragmas.includes(pragma)) { existing.pragmas.push(pragma); }
				}
				existing.drivenBy ??= keyword.drivenBy;
			}
		}
	}
	merged.keywords = [...keywords.values()];
	merged.hasPragmas = primary.hasPragmas || others.some((o) => o.hasPragmas);
	return merged;
}

/**
 * Resolves the struct type of `varName` from the declarations visible before `offsetEnd`, e.g.
 * `VertexOutput OUT;`, `Light mainLight = GetMainLight();`, or a function parameter `(VertexInput IN)`.
 * `typeNames` limits the search to known struct names. Returns the last matching declaration's type.
 */
export function findVariableStructType(maskedTextBefore: string, varName: string, typeNames: Set<string>): string | undefined {
	const regex = new RegExp(`\\b([A-Za-z_]\\w*)\\s+${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\s*\\()`, 'g');
	let found: string | undefined;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(maskedTextBefore))) {
		if (typeNames.has(m[1])) { found = m[1]; }
	}
	return found;
}
