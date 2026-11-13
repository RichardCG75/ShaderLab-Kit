// Builds and updates the stock three.js material that stands in for the shader (see
// src/preview/stockMaterialBackend.ts): MeshBasicMaterial for unlit shaders, MeshStandardMaterial
// for lit ones, with the shader's render state applied. It never runs the shader's own HLSL.

import * as three from 'three';
import type { BuiltinTexture, PropertyControl, TextureControl, Vec4 } from '../analysis/materialProperties';
import { numericValue } from '../preview/materialValues';
import type { MaterialValues, PreviewProgram, ResolvedTexture, TextureSlotValue } from '../preview/protocol';
import { resolveRenderState, type BlendFactor, type CompareFunction } from '../preview/renderState';

const BLEND_FACTORS: Record<BlendFactor, three.BlendingSrcFactor> = {
	Zero: three.ZeroFactor, One: three.OneFactor, SrcColor: three.SrcColorFactor, OneMinusSrcColor: three.OneMinusSrcColorFactor,
	SrcAlpha: three.SrcAlphaFactor, OneMinusSrcAlpha: three.OneMinusSrcAlphaFactor, DstAlpha: three.DstAlphaFactor,
	OneMinusDstAlpha: three.OneMinusDstAlphaFactor, DstColor: three.DstColorFactor, OneMinusDstColor: three.OneMinusDstColorFactor,
	SrcAlphaSaturate: three.SrcAlphaSaturateFactor,
};

const DEPTH_FUNCS: Record<CompareFunction, three.DepthModes> = {
	Never: three.NeverDepth, Less: three.LessDepth, Equal: three.EqualDepth, LEqual: three.LessEqualDepth,
	Greater: three.GreaterDepth, NotEqual: three.NotEqualDepth, GEqual: three.GreaterEqualDepth, Always: three.AlwaysDepth,
};

const BUILTIN_PIXELS: Record<BuiltinTexture, [number, number, number, number]> = {
	white: [255, 255, 255, 255], black: [0, 0, 0, 255], gray: [128, 128, 128, 255], bump: [128, 128, 255, 255], red: [255, 0, 0, 255],
};

function builtinTexture(name: BuiltinTexture): three.DataTexture {
	const texture = new three.DataTexture(new Uint8Array(BUILTIN_PIXELS[name]), 1, 1, three.RGBAFormat);
	texture.needsUpdate = true;
	return texture;
}

type StockMaterial = three.MeshBasicMaterial | three.MeshStandardMaterial;

export class MaterialBinder {
	private program: PreviewProgram | undefined;
	private controls: PropertyControl[] = [];
	private values: MaterialValues = {};
	private material: StockMaterial | undefined;
	private wireframe = false;
	/** Decoded file textures by property name. */
	private readonly fileTextures = new Map<string, three.Texture>();
	private readonly builtins = new Map<BuiltinTexture, three.DataTexture>();
	/** Guards against an older decode finishing after a newer one for the same slot. */
	private readonly textureRequests = new Map<string, number>();
	/** ResolvedTexture.key of each decoded file texture. */
	private readonly textureKeys = new Map<string, string>();

	constructor(
		private readonly onMaterial: (material: three.Material) => void,
		private readonly onError: (message: string) => void,
	) {}

	/** Replaces the whole state after the shader changed. */
	setShader(program: PreviewProgram | undefined, controls: PropertyControl[], values: MaterialValues, textures: Record<string, ResolvedTexture>): void {
		const modelChanged = !this.material || this.program?.model !== program?.model;
		this.program = program;
		this.controls = controls;
		this.values = { ...values };
		for (const name of [...this.fileTextures.keys()]) {
			if (!(name in textures)) {
				this.dropTexture(name);
			}
		}
		for (const [name, texture] of Object.entries(textures)) {
			void this.setTexture(name, texture);
		}
		if (modelChanged) {
			this.material = program?.model === 'lit' || !program ? new three.MeshStandardMaterial() : new three.MeshBasicMaterial();
			this.onMaterial(this.material);
		}
		this.apply();
	}

	setValue(name: string, value: MaterialValues[string]): void {
		this.values[name] = value;
		this.apply();
	}

	setWireframe(wireframe: boolean): void {
		this.wireframe = wireframe;
		this.apply();
	}

	private dropTexture(name: string): void {
		this.fileTextures.get(name)?.dispose();
		this.fileTextures.delete(name);
		this.textureKeys.delete(name);
	}

	/** Decodes a texture file sent by the host; an empty `texture` reverts the slot to its default. */
	async setTexture(name: string, texture: ResolvedTexture): Promise<void> {
		if (texture.key !== undefined && this.textureKeys.get(name) === texture.key) {
			return;
		}
		const request = (this.textureRequests.get(name) ?? 0) + 1;
		this.textureRequests.set(name, request);
		if (!texture.data || !texture.mimeType) {
			if (texture.key !== undefined) {
				// The host believes we hold this file already (decoded for another slot or before a reset).
				const owner = [...this.textureKeys.entries()].find(([, key]) => key === texture.key)?.[0];
				const shared = owner === undefined ? undefined : this.fileTextures.get(owner);
				if (shared) {
					const copy = shared.clone();
					copy.needsUpdate = true;
					this.dropTexture(name);
					this.fileTextures.set(name, copy);
					this.textureKeys.set(name, texture.key);
					this.apply();
					return;
				}
				this.onError(`Texture ${texture.label ?? name} was not received; reopen the preview to reload it.`);
			}
			this.dropTexture(name);
			this.apply();
			return;
		}
		try {
			const bitmap = await createImageBitmap(new Blob([texture.data as Uint8Array<ArrayBuffer>], { type: texture.mimeType }), {
				imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
			});
			if (this.textureRequests.get(name) !== request) {
				bitmap.close();
				return;
			}
			const decoded = new three.Texture(bitmap);
			decoded.flipY = false;
			decoded.wrapS = decoded.wrapT = three.RepeatWrapping;
			decoded.anisotropy = 4;
			decoded.needsUpdate = true;
			this.dropTexture(name);
			this.fileTextures.set(name, decoded);
			if (texture.key !== undefined) {
				this.textureKeys.set(name, texture.key);
			}
			this.apply();
		} catch (error) {
			this.onError(`Could not decode ${texture.label ?? name}: ${String(error)}`);
		}
	}

	private builtin(name: BuiltinTexture): three.DataTexture {
		let texture = this.builtins.get(name);
		if (!texture) {
			texture = builtinTexture(name);
			this.builtins.set(name, texture);
		}
		return texture;
	}

	private control(name: string | undefined): PropertyControl | undefined {
		return name === undefined ? undefined : this.controls.find((c) => c.name === name);
	}

	private number(name: string | undefined, fallback: number): number {
		return name === undefined ? fallback : numericValue(this.values[name]) ?? fallback;
	}

	private vec4(name: string | undefined): Vec4 | undefined {
		const value = name === undefined ? undefined : this.values[name];
		return Array.isArray(value) ? value : undefined;
	}

	/**
	 * The texture for a slot: the decoded file, else the declared built-in default. `fileOnly` slots
	 * (normal/emission maps) use no texture at all rather than a flat built-in.
	 */
	private texture(name: string | undefined, colorSpace: three.ColorSpace, fileOnly: boolean): three.Texture | null {
		if (name === undefined) {
			return null;
		}
		const file = this.fileTextures.get(name);
		const control = this.control(name) as TextureControl | undefined;
		let texture: three.Texture | null = file ?? null;
		if (!texture && !fileOnly) {
			// An empty or unknown default name is treated as gray, Unity's documented fallback.
			texture = this.builtin(control?.defaultTexture || 'gray');
		}
		if (texture) {
			if (texture.colorSpace !== colorSpace) {
				texture.colorSpace = colorSpace;
				texture.needsUpdate = true;
			}
			const slot = this.values[name] as TextureSlotValue | undefined;
			if (file && slot && control?.scaleOffset !== false) {
				texture.repeat.set(slot.tiling[0], slot.tiling[1]);
				texture.offset.set(slot.offset[0], slot.offset[1]);
			}
		}
		return texture;
	}

	private apply(): void {
		const material = this.material;
		if (!material) {
			return;
		}
		const program = this.program;
		const slots = program?.slots ?? {};
		let needsUpdate = false;
		const setMap = <K extends 'map' | 'normalMap' | 'emissiveMap'>(target: { [P in K]: three.Texture | null }, key: K, texture: three.Texture | null) => {
			if (target[key] !== texture) {
				// Adding or removing a map changes the compiled program.
				needsUpdate ||= (target[key] === null) !== (texture === null);
				target[key] = texture;
			}
		};

		const color = this.vec4(slots.baseColor) ?? [1, 1, 1, 1];
		material.color.setRGB(color[0], color[1], color[2], three.SRGBColorSpace);
		material.opacity = color[3];
		setMap(material, 'map', this.texture(slots.baseMap, three.SRGBColorSpace, false));

		if (material instanceof three.MeshStandardMaterial) {
			material.metalness = three.MathUtils.clamp(this.number(slots.metallic, 0), 0, 1);
			material.roughness = three.MathUtils.clamp(1 - this.number(slots.smoothness, 0.5), 0.02, 1);
			setMap(material, 'normalMap', this.texture(slots.normalMap, three.NoColorSpace, true));
			const scale = this.number(slots.normalScale, 1);
			material.normalScale.set(scale, scale);
			const emission = this.vec4(slots.emissionColor);
			const emissionMap = this.texture(slots.emissionMap, three.SRGBColorSpace, true);
			if (emission) {
				material.emissive.setRGB(emission[0], emission[1], emission[2], three.SRGBColorSpace);
			} else {
				material.emissive.setRGB(emissionMap ? 1 : 0, emissionMap ? 1 : 0, emissionMap ? 1 : 0);
			}
			setMap(material, 'emissiveMap', emissionMap);
		}

		const clipOn = slots.alphaClip !== undefined ? this.number(slots.alphaClip, 0) !== 0 : slots.alwaysClip === true;
		const alphaTest = slots.cutoff !== undefined && clipOn ? three.MathUtils.clamp(this.number(slots.cutoff, 0.5), 0.0001, 1) : 0;
		if ((material.alphaTest > 0) !== (alphaTest > 0)) {
			needsUpdate = true;
		}
		material.alphaTest = alphaTest;

		const state = resolveRenderState(program?.renderState ?? {}, (name) => numericValue(this.values[name]));
		material.side = state.cull === 'Back' ? three.FrontSide : state.cull === 'Front' ? three.BackSide : three.DoubleSide;
		material.depthWrite = state.zWrite;
		material.depthTest = true;
		material.depthFunc = DEPTH_FUNCS[state.zTest];
		material.colorWrite = state.colorMask !== '';
		const transparent = state.blend !== undefined;
		if (material.transparent !== transparent) {
			needsUpdate = true;
		}
		material.transparent = transparent;
		if (state.blend) {
			material.blending = three.CustomBlending;
			material.blendEquation = three.AddEquation;
			material.blendSrc = BLEND_FACTORS[state.blend.src];
			material.blendDst = BLEND_FACTORS[state.blend.dst] as three.BlendingDstFactor;
			material.blendSrcAlpha = BLEND_FACTORS[state.blend.srcAlpha];
			material.blendDstAlpha = BLEND_FACTORS[state.blend.dstAlpha] as three.BlendingDstFactor;
		} else {
			material.blending = three.NormalBlending;
		}
		material.wireframe = this.wireframe;
		if (needsUpdate) {
			material.needsUpdate = true;
		}
	}
}
