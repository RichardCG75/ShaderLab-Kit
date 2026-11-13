// Pure resolution of ShaderLab render state (`Cull`, `ZWrite`, `ZTest`, `Blend`, `ColorMask`) as
// written in the shader into concrete values, looking up `[_Property]` references in the material.
// Numeric property values follow UnityEngine.Rendering's CullMode / BlendMode / CompareFunction.

import type { RawRenderState } from '../analysis/shaderStructure';

export type CullMode = 'Back' | 'Front' | 'Off';
export type CompareFunction = 'Never' | 'Less' | 'Equal' | 'LEqual' | 'Greater' | 'NotEqual' | 'GEqual' | 'Always';
export type BlendFactor =
	| 'Zero' | 'One' | 'DstColor' | 'SrcColor' | 'OneMinusDstColor' | 'SrcAlpha' | 'OneMinusSrcColor'
	| 'DstAlpha' | 'OneMinusDstAlpha' | 'SrcAlphaSaturate' | 'OneMinusSrcAlpha';

export interface BlendState {
	src: BlendFactor;
	dst: BlendFactor;
	srcAlpha: BlendFactor;
	dstAlpha: BlendFactor;
}

export interface ResolvedRenderState {
	cull: CullMode;
	zWrite: boolean;
	zTest: CompareFunction;
	/** Undefined means `Blend Off` (opaque). */
	blend?: BlendState;
	/** Channels written, e.g. `RGBA`, `RGB`, or '' for `ColorMask 0`. */
	colorMask: string;
	/** `[_Property]` names the state depends on. */
	references: string[];
}

const CULL_BY_NUMBER: CullMode[] = ['Off', 'Front', 'Back'];
const BLEND_BY_NUMBER: BlendFactor[] = [
	'Zero', 'One', 'DstColor', 'SrcColor', 'OneMinusDstColor', 'SrcAlpha', 'OneMinusSrcColor',
	'DstAlpha', 'OneMinusDstAlpha', 'SrcAlphaSaturate', 'OneMinusSrcAlpha',
];
// CompareFunction 0 is `Disabled`, which behaves like `Always`.
const COMPARE_BY_NUMBER: CompareFunction[] = ['Always', 'Never', 'Less', 'Equal', 'LEqual', 'Greater', 'NotEqual', 'GEqual', 'Always'];
const COMPARE_NAMES: CompareFunction[] = ['Never', 'Less', 'Equal', 'LEqual', 'Greater', 'NotEqual', 'GEqual', 'Always'];

function byName<T extends string>(names: readonly T[], token: string): T | undefined {
	return names.find((n) => n.toLowerCase() === token.toLowerCase());
}

/**
 * Resolves one state token: a literal name, a number, or `[_Prop]`. `fromNumber` maps a numeric value
 * (literal or from the material) to a name.
 */
function resolveToken<T extends string>(
	token: string, names: readonly T[], fromNumber: (n: number) => T | undefined,
	lookup: (name: string) => number | undefined, references: string[],
): T | undefined {
	const ref = token.match(/^\[\s*(\w+)\s*\]$/);
	if (ref) {
		references.push(ref[1]);
		const n = lookup(ref[1]);
		return n === undefined ? undefined : fromNumber(Math.round(n));
	}
	if (/^-?\d+(\.\d+)?$/.test(token)) {
		return fromNumber(Math.round(Number(token)));
	}
	return byName(names, token);
}

function parseBlend(raw: string, lookup: (name: string) => number | undefined, references: string[]): BlendState | undefined {
	let tokens = raw.split(/[\s,]+/).filter((t) => t.length > 0);
	if (tokens.length === 0 || tokens[0].toLowerCase() === 'off') {
		return undefined;
	}
	// `Blend 1 SrcAlpha OneMinusSrcAlpha`: a leading render-target index.
	if ((tokens.length === 3 || tokens.length === 5) && /^\d+$/.test(tokens[0])) {
		tokens = tokens.slice(1);
	}
	const factor = (t: string | undefined) =>
		t === undefined ? undefined : resolveToken(t, BLEND_BY_NUMBER, (n) => BLEND_BY_NUMBER[n], lookup, references);
	const src = factor(tokens[0]);
	const dst = factor(tokens[1]);
	if (!src || !dst) {
		return undefined;
	}
	// Blend One Zero is the same as opaque.
	const srcAlpha = factor(tokens[2]) ?? src;
	const dstAlpha = factor(tokens[3]) ?? dst;
	if (src === 'One' && dst === 'Zero' && srcAlpha === 'One' && dstAlpha === 'Zero') {
		return undefined;
	}
	return { src, dst, srcAlpha, dstAlpha };
}

/** Resolves the written state; anything missing or unresolvable falls back to ShaderLab's defaults. */
export function resolveRenderState(raw: RawRenderState, lookup: (name: string) => number | undefined): ResolvedRenderState {
	const references: string[] = [];
	const cull = raw.cull === undefined ? undefined
		: resolveToken(raw.cull.split(' ')[0], CULL_BY_NUMBER, (n) => CULL_BY_NUMBER[n], lookup, references);
	const zWriteToken = raw.zWrite?.split(' ')[0];
	let zWrite = true;
	if (zWriteToken !== undefined) {
		const ref = zWriteToken.match(/^\[\s*(\w+)\s*\]$/);
		if (ref) {
			references.push(ref[1]);
			zWrite = (lookup(ref[1]) ?? 1) !== 0;
		} else {
			zWrite = zWriteToken.toLowerCase() !== 'off' && zWriteToken !== '0';
		}
	}
	const zTest = raw.zTest === undefined ? undefined
		: resolveToken(raw.zTest.split(' ')[0], COMPARE_NAMES, (n) => COMPARE_BY_NUMBER[n], lookup, references);
	const blend = raw.blend === undefined ? undefined : parseBlend(raw.blend, lookup, references);
	const mask = raw.colorMask?.split(' ')[0];
	let colorMask = 'RGBA';
	const maskRef = mask?.match(/^\[\s*(\w+)\s*\]$/);
	if (maskRef) {
		// A ColorWriteMask value: 0 writes nothing; partial masks are approximated as all channels.
		references.push(maskRef[1]);
		colorMask = lookup(maskRef[1]) === 0 ? '' : 'RGBA';
	} else if (mask !== undefined) {
		colorMask = mask === '0' ? '' : mask.toUpperCase();
	}
	return { cull: cull ?? 'Back', zWrite, zTest: zTest ?? 'LEqual', blend, colorMask, references };
}
