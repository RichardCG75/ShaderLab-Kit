// Pure (vscode-free) outline of a ShaderLab file's structure: the shader name, its SubShaders and
// Passes, their `Tags`, and the fixed-function render state (`Cull`, `ZWrite`, `ZTest`, `Blend`,
// `ColorMask`) each declares. State values are kept as written (`Back`, `[_Cull]`, `SrcAlpha
// OneMinusSrcAlpha`) and resolved later against material values (see src/preview/renderState.ts).
// Like shaderSymbols.ts it is brace-depth based, not a full parser.

import { maskDocument } from '../utils/commentMask';
import { ADVANCE_CARRY_LENGTH, advanceBlockStack } from './shaderSymbols';

/** Render state statements as written, e.g. `{ cull: '[_Cull]', blend: 'SrcAlpha OneMinusSrcAlpha' }`. */
export interface RawRenderState {
	cull?: string;
	zWrite?: string;
	zTest?: string;
	blend?: string;
	colorMask?: string;
}

export interface PassOutline {
	/** From `Name "..."`; empty when the pass is unnamed. */
	name: string;
	tags: Record<string, string>;
	state: RawRenderState;
	/** Whether the pass has an `HLSLPROGRAM` block. */
	hasHlsl: boolean;
	line: number;
}

export interface SubShaderOutline {
	tags: Record<string, string>;
	/** State set at SubShader level; passes inherit it unless they override. */
	state: RawRenderState;
	passes: PassOutline[];
	/** `UsePass "Shader/NAME"` references. */
	usePasses: string[];
	line: number;
}

export interface ShaderOutline {
	/** From `Shader "Name"`; undefined when the file has no Shader block (e.g. an .hlsl include). */
	name?: string;
	subShaders: SubShaderOutline[];
	/** Whether the file uses legacy `CGPROGRAM` blocks (out of scope for ShaderLab Kit). */
	usesCgProgram: boolean;
}

const STATE_KEYS: Record<string, keyof RawRenderState> = {
	cull: 'cull', zwrite: 'zWrite', ztest: 'zTest', blend: 'blend', colormask: 'colorMask',
};

/** Parses `"Key" = "Value"` pairs from the raw text between the braces of a `Tags { }` block. */
export function parseTags(raw: string): Record<string, string> {
	const tags: Record<string, string> = {};
	const regex = /"([^"]*)"\s*=\s*"([^"]*)"/g;
	let m: RegExpExecArray | null;
	while ((m = regex.exec(raw))) {
		tags[m[1].trim()] = m[2].trim();
	}
	return tags;
}

export function extractShaderOutline(text: string): ShaderOutline {
	const rawLines = text.split(/\r\n|\r|\n/);
	const maskedText = maskDocument(text);
	const maskedLines = maskedText.split('\n');

	const outline: ShaderOutline = { subShaders: [], usesCgProgram: /\bCGPROGRAM\b/.test(maskedText) };
	const nameMatch = text.match(/^\s*Shader\s+"([^"]*)"/m);
	if (nameMatch && /^\s*Shader\s+"/m.test(maskedText)) {
		outline.name = nameMatch[1];
	}

	const stack: string[] = [];
	let carry = '';
	let subShader: SubShaderOutline | undefined;
	let pass: PassOutline | undefined;
	/** Raw text of a `Tags { ... }` block that spans several lines, while it is open. */
	let openTags: { text: string; target: Record<string, string> } | undefined;
	/** Set after a line ending in a bare `Tags`, whose `{` comes on the next line (Allman style). */
	let pendingTags: Record<string, string> | undefined;

	for (let i = 0; i < rawLines.length; i++) {
		const raw = rawLines[i];
		const masked = maskedLines[i] ?? '';
		const top = stack[stack.length - 1];
		const inShaderLabScope = top === 'SubShader' || top === 'Pass';

		if (openTags) {
			const close = masked.indexOf('}');
			openTags.text += '\n' + (close === -1 ? raw : raw.slice(0, close));
			if (close !== -1) {
				Object.assign(openTags.target, parseTags(openTags.text));
				openTags = undefined;
			}
		} else if (inShaderLabScope) {
			const target = top === 'Pass' ? pass : subShader;
			if (target) {
				// `Tags { ... }` on one line, `Tags {` spanning lines, or `Tags` with `{` on the next line.
				let open = -1;
				let tagsTarget = target.tags;
				const tagsAt = masked.search(/\bTags\s*\{/);
				if (tagsAt !== -1) {
					open = masked.indexOf('{', tagsAt);
				} else if (pendingTags && /^\s*\{/.test(masked)) {
					open = masked.indexOf('{');
					tagsTarget = pendingTags;
				}
				pendingTags = /\bTags\s*$/.test(masked) ? target.tags : undefined;
				if (open !== -1) {
					const close = masked.indexOf('}', open);
					if (close === -1) {
						openTags = { text: raw.slice(open + 1), target: tagsTarget };
					} else {
						Object.assign(tagsTarget, parseTags(raw.slice(open + 1, close)));
					}
				}

				const statement = masked.match(/^\s*(Cull|ZWrite|ZTest|Blend|ColorMask)\b\s*([^{}]*?)\s*$/i);
				if (statement) {
					target.state[STATE_KEYS[statement[1].toLowerCase()]] = statement[2].replace(/\s+/g, ' ');
				}
				if (pass && top === 'Pass') {
					const name = raw.match(/^\s*Name\s+"([^"]*)"/);
					if (name) {
						pass.name = name[1];
					}
				}
				const usePass = raw.match(/^\s*UsePass\s+"([^"]*)"/);
				if (usePass && subShader && top === 'SubShader') {
					subShader.usePasses.push(usePass[1]);
				}
			}
		}

		const before = stack.length;
		advanceBlockStack(stack, masked, carry);
		carry = (carry + masked + '\n').slice(-ADVANCE_CARRY_LENGTH);

		// Blocks opened on this line: start a SubShader / Pass when its label was pushed.
		for (let depth = before; depth < stack.length; depth++) {
			if (stack[depth] === 'SubShader') {
				subShader = { tags: {}, state: {}, passes: [], usePasses: [], line: i };
				outline.subShaders.push(subShader);
				pass = undefined;
			} else if (stack[depth] === 'Pass' && subShader) {
				pass = { name: '', tags: {}, state: {}, hasHlsl: false, line: i };
				subShader.passes.push(pass);
			} else if (stack[depth] === 'HLSL' && pass && stack.includes('Pass')) {
				pass.hasHlsl = true;
			}
		}
		// A pass whose opening line also held a statement or Tags (`Pass { Cull Off`) is rare; ignored.
		if (!stack.includes('Pass')) {
			pass = undefined;
		}
		if (!stack.includes('SubShader')) {
			subShader = undefined;
		}
	}

	return outline;
}

/** LightMode values of passes the preview would never draw as the visible surface. */
const NON_COLOR_LIGHT_MODES = new Set([
	'shadowcaster', 'depthonly', 'depthnormals', 'depthnormalsonly', 'meta', 'motionvectors', 'universalgbuffer',
]);
const PREFERRED_LIGHT_MODES = ['universalforward', 'universalforwardonly', 'srpdefaultunlit', ''];

export interface SelectedPass {
	subShader: SubShaderOutline;
	pass: PassOutline;
	/** SubShader state with the pass's own statements applied on top. */
	state: RawRenderState;
}

/**
 * Picks the pass that renders the visible surface: the first URP-compatible SubShader (skipping
 * HDRP-only ones), then its first forward / unlit pass, then any other color pass.
 */
export function selectPreviewPass(outline: ShaderOutline): SelectedPass | undefined {
	const subShaders = outline.subShaders.filter((s) => {
		const pipeline = (s.tags['RenderPipeline'] ?? '').toLowerCase();
		return pipeline === '' || pipeline === 'universalpipeline';
	});
	for (const subShader of subShaders) {
		const lightMode = (p: PassOutline) => (p.tags['LightMode'] ?? '').toLowerCase();
		const pass = PREFERRED_LIGHT_MODES.map((mode) => subShader.passes.find((p) => lightMode(p) === mode)).find((p) => p)
			?? subShader.passes.find((p) => !NON_COLOR_LIGHT_MODES.has(lightMode(p)));
		if (pass) {
			return { subShader, pass, state: { ...subShader.state, ...pass.state } };
		}
	}
	return undefined;
}
