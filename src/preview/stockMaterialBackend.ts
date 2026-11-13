// MVP preview backend: does not run the shader's HLSL. It picks the pass that draws the visible
// surface, reads its render state, decides between an unlit and a simple lit look, and maps the
// shader's recognised properties (base color/map, normal map, metallic, smoothness, emission, alpha
// clip) onto a stock three.js material in the webview. Everything else is reported as "not previewed".

import type { PropertyControl } from '../analysis/materialProperties';
import { extractSymbols } from '../analysis/shaderSymbols';
import { extractShaderOutline, selectPreviewPass } from '../analysis/shaderStructure';
import { maskDocument } from '../utils/commentMask';
import type { PreviewBackend, PreviewRequest, PreviewResult } from './backend';
import type { MaterialSlots, PreviewProgram } from './protocol';
import { resolveRenderState } from './renderState';

type Kind = PropertyControl['kind'];

/** First control matching an attribute flag, else the first one named like a conventional URP property. */
function pick(
	controls: PropertyControl[], kinds: Kind[], names: string[], flag?: (c: PropertyControl) => boolean,
): string | undefined {
	const candidates = controls.filter((c) => kinds.includes(c.kind));
	const flagged = flag ? candidates.find(flag) : undefined;
	if (flagged) {
		return flagged.name;
	}
	for (const name of names) {
		const found = candidates.find((c) => c.name === name);
		if (found) {
			return found.name;
		}
	}
	return undefined;
}

const is2D = (c: PropertyControl) => c.kind === 'texture' && c.dimension === '2D';
const NUMERIC: Kind[] = ['float', 'range', 'int'];

/** Signs that a shader computes lighting rather than being unlit (checked on comment-masked text). */
const LIT_CALL = /\b(GetMainLight|UniversalFragmentPBR|UniversalFragmentBlinnPhong|LightingLambert|LightingPhysicallyBased|GetAdditionalLight)\s*\(/;
const LIT_INCLUDE = /(^|\/)Lighting\.hlsl$/;

export function buildStockProgram(request: PreviewRequest): PreviewResult {
	const { text, controls } = request;
	const outline = extractShaderOutline(text);
	if (outline.name === undefined) {
		return { ok: false, unsupported: { reason: 'This file has no `Shader "..."` block, so there is no material to preview. Open a .shader file.' } };
	}
	const selected = selectPreviewPass(outline);
	if (!selected) {
		const hdrpOnly = outline.subShaders.length > 0
			&& outline.subShaders.every((s) => (s.tags['RenderPipeline'] ?? '').toLowerCase() === 'highdefinitionrenderpipeline');
		const usePassOnly = outline.subShaders.some((s) => s.passes.length === 0 && s.usePasses.length > 0);
		const reason = hdrpOnly ? 'Only HDRP SubShaders were found; the preview covers URP and pipeline-agnostic shaders.'
			: usePassOnly ? 'The SubShader only reuses passes with `UsePass`, which the preview does not resolve.'
				: 'No pass that draws color was found (only ShadowCaster / DepthOnly / Meta-style passes, or no Pass at all).';
		return { ok: false, unsupported: { reason, line: outline.subShaders[0]?.line } };
	}

	const masked = maskDocument(text);
	const visible = controls.filter((c) => !c.hidden && c.kind !== 'unknown');
	const lit = LIT_CALL.test(masked)
		|| extractSymbols(text).includes.some((include) => LIT_INCLUDE.test(include))
		|| visible.some((c) => c.name === '_Metallic' || c.name === '_Smoothness');

	const slots: MaterialSlots = {
		baseColor: pick(controls, ['color'], ['_BaseColor', '_Color', '_Tint', '_TintColor', '_MainColor'],
			(c) => c.kind === 'color' && c.isMainColor),
		baseMap: pick(controls.filter(is2D), ['texture'], ['_BaseMap', '_MainTex', '_Albedo', '_AlbedoMap', '_BaseColorMap'],
			(c) => c.kind === 'texture' && c.isMainTexture),
		cutoff: pick(controls, NUMERIC, ['_Cutoff', '_AlphaCutoff', '_Clip']),
		alphaClip: pick(controls, ['toggle'], ['_AlphaClip', '_AlphaTest']),
	};
	if (slots.cutoff && !slots.alphaClip) {
		slots.alwaysClip = /\bclip\s*\(/.test(masked);
	}
	if (lit) {
		slots.normalMap = pick(controls.filter(is2D), ['texture'], ['_BumpMap', '_NormalMap', '_NormalTex'],
			(c) => c.kind === 'texture' && c.normalMap);
		slots.normalScale = pick(controls, NUMERIC, ['_BumpScale', '_NormalScale', '_NormalStrength']);
		slots.metallic = pick(controls, NUMERIC, ['_Metallic', '_Metalness']);
		slots.smoothness = pick(controls, NUMERIC, ['_Smoothness', '_Glossiness']);
		slots.emissionColor = pick(controls, ['color'], ['_EmissionColor', '_Emission', '_EmissiveColor']);
		slots.emissionMap = pick(controls.filter(is2D), ['texture'], ['_EmissionMap', '_EmissiveMap']);
	}

	const stateRefs = resolveRenderState(selected.state, () => undefined).references;
	const used = new Set<string>([...Object.values(slots).filter((v): v is string => typeof v === 'string'), ...stateRefs]);
	const mapped = visible.filter((c) => used.has(c.name)).map((c) => c.name);
	const unmapped = visible.filter((c) => !used.has(c.name)).map((c) => c.name);

	const notes: string[] = [
		lit ? 'Lighting is approximated with a generic PBR material; URP\'s BRDF, shadows, GI and additional lights are not reproduced.'
			: 'Drawn unlit: base color × base map, with alpha clip and blending when the shader declares them.',
	];
	if (outline.usesCgProgram) {
		notes.push('This shader uses CGPROGRAM, which is outside ShaderLab Kit\'s HLSL/URP scope.');
	}
	if (selected.pass.tags['LightMode'] === undefined && selected.subShader.passes.length > 1) {
		notes.push('Several passes found; previewing the first one without a LightMode tag.');
	}

	const program: PreviewProgram = {
		backend: 'stock', model: lit ? 'lit' : 'unlit',
		passName: selected.pass.name, lightMode: selected.pass.tags['LightMode'] ?? '',
		slots, renderState: selected.state, mapped, unmapped, notes,
	};
	return { ok: true, program };
}

export const stockMaterialBackend: PreviewBackend = {
	id: 'stock',
	compile: async (request) => buildStockProgram(request),
};
