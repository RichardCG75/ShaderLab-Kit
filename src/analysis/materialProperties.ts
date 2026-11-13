// Pure (vscode-free) typed model of a shader's material properties: turns the raw `ShaderProperty`
// records from `extractSymbols` into Inspector-style controls (what widget to show, its range, options,
// default value and the shader keyword it drives). It adds a typed layer on top of `shaderSymbols.ts`
// and never changes it. Used by the shader preview's material editor.

import { keywordEnumKeyword, type ShaderProperty } from './shaderSymbols';

export type BuiltinTexture = 'white' | 'black' | 'gray' | 'bump' | 'red';
export type TextureDimension = '2D' | '3D' | 'Cube' | '2DArray' | 'CubeArray';
export type Vec4 = [number, number, number, number];

export interface EnumOption {
	label: string;
	value: number;
}

/** Fields shared by every control. */
export interface ControlBase {
	name: string;
	label: string;
	/** `[HideInInspector]`: still a property, but not drawn. */
	hidden: boolean;
	/** `[PerRendererData]`: supplied through a MaterialPropertyBlock, not edited on the material. */
	perRendererData: boolean;
	/** Text of a `[Header(...)]` drawn above this property. */
	header?: string;
	/** `[Space]` / `[Space(n)]`: extra pixels above this property. */
	space?: number;
	line: number;
}

export interface FloatControl extends ControlBase {
	kind: 'float';
	defaultValue: number;
}

export interface IntControl extends ControlBase {
	kind: 'int';
	defaultValue: number;
}

export interface RangeControl extends ControlBase {
	kind: 'range';
	min: number;
	max: number;
	defaultValue: number;
	/** `[PowerSlider(p)]`: non-linear slider (value = t^p). */
	power?: number;
	/** `[IntRange]`: slider snaps to integers. */
	integer: boolean;
}

export interface ColorControl extends ControlBase {
	kind: 'color';
	defaultValue: Vec4;
	/** `[HDR]`: intensities above 1 are allowed. */
	hdr: boolean;
	/** `[Gamma]`: entered in gamma space, converted to linear in a Linear project. */
	gamma: boolean;
	/** `[MainColor]`. Falling back to the conventional `_Color` / `_BaseColor` names is left to callers. */
	isMainColor: boolean;
}

export interface VectorControl extends ControlBase {
	kind: 'vector';
	defaultValue: Vec4;
	gamma: boolean;
}

export interface TextureControl extends ControlBase {
	kind: 'texture';
	dimension: TextureDimension;
	/** Built-in default named in the declaration (`"white" {}`); '' when empty or not a known name. */
	defaultTexture: BuiltinTexture | '';
	/** False for `[NoScaleOffset]` (no Tiling/Offset fields, so no `_ST` needed). */
	scaleOffset: boolean;
	/** `[Normal]`: the texture is expected to be a normal map. */
	normalMap: boolean;
	/** `[MainTexture]`. */
	isMainTexture: boolean;
}

export interface ToggleControl extends ControlBase {
	kind: 'toggle';
	defaultValue: boolean;
	/** Keyword switched by this checkbox; undefined for `[ToggleUI]`. */
	keyword?: string;
	/** `[ToggleOff]`: the keyword is enabled while the checkbox is unchecked. */
	invert: boolean;
}

export interface KeywordEnumControl extends ControlBase {
	kind: 'keywordEnum';
	/** Option `value` is the index; `keyword` is the one keyword enabled for that option. */
	options: (EnumOption & { keyword: string })[];
	defaultValue: number;
}

export interface EnumControl extends ControlBase {
	kind: 'enum';
	/** Undefined when the `[Enum(Some.Type)]` type is not one we know; callers fall back to a number field. */
	options?: EnumOption[];
	/** The type name written in `[Enum(UnityEngine.Rendering.CullMode)]`, if that form was used. */
	enumType?: string;
	defaultValue: number;
}

/** A property whose type we don't model (kept so it isn't silently dropped). */
export interface UnknownControl extends ControlBase {
	kind: 'unknown';
	rawType: string;
}

export type PropertyControl =
	| FloatControl
	| IntControl
	| RangeControl
	| ColorControl
	| VectorControl
	| TextureControl
	| ToggleControl
	| KeywordEnumControl
	| EnumControl
	| UnknownControl;

/** Numeric values of the UnityEngine.Rendering enums commonly used with `[Enum(...)]`. */
const KNOWN_ENUM_TYPES: Record<string, EnumOption[]> = {
	CullMode: [{ label: 'Off', value: 0 }, { label: 'Front', value: 1 }, { label: 'Back', value: 2 }],
	BlendMode: [
		{ label: 'Zero', value: 0 }, { label: 'One', value: 1 }, { label: 'DstColor', value: 2 },
		{ label: 'SrcColor', value: 3 }, { label: 'OneMinusDstColor', value: 4 }, { label: 'SrcAlpha', value: 5 },
		{ label: 'OneMinusSrcColor', value: 6 }, { label: 'DstAlpha', value: 7 }, { label: 'OneMinusDstAlpha', value: 8 },
		{ label: 'SrcAlphaSaturate', value: 9 }, { label: 'OneMinusSrcAlpha', value: 10 },
	],
	CompareFunction: [
		{ label: 'Disabled', value: 0 }, { label: 'Never', value: 1 }, { label: 'Less', value: 2 },
		{ label: 'Equal', value: 3 }, { label: 'LessEqual', value: 4 }, { label: 'Greater', value: 5 },
		{ label: 'NotEqual', value: 6 }, { label: 'GreaterEqual', value: 7 }, { label: 'Always', value: 8 },
	],
};

const BUILTIN_TEXTURES: readonly string[] = ['white', 'black', 'gray', 'bump', 'red'];
const TEXTURE_DIMENSIONS: readonly string[] = ['2D', '3D', 'Cube', '2DArray', 'CubeArray'];

interface ParsedAttribute {
	name: string;
	/** Comma-separated arguments, trimmed; empty when there are none. */
	args: string[];
}

function parseAttribute(attribute: string): ParsedAttribute | undefined {
	const m = attribute.match(/^\s*(\w+)\s*(?:\(([\s\S]*)\))?\s*$/);
	if (!m) {
		return undefined;
	}
	const args = m[2] === undefined ? [] : m[2].split(',').map((a) => a.trim()).filter((a) => a.length > 0);
	return { name: m[1], args };
}

function parseNumber(text: string | undefined, fallback: number): number {
	if (text === undefined) {
		return fallback;
	}
	const n = parseFloat(text);
	return Number.isFinite(n) ? n : fallback;
}

/** Parses `(1, 0.5, 0, 1)`; missing components become 0 (alpha of a color becomes 1). */
export function parseVec4(text: string, missingAlpha = 0): Vec4 {
	const m = text.match(/\(([^)]*)\)/);
	const parts = m ? m[1].split(',').map((p) => p.trim()) : [];
	const values = parts.map((p) => parseNumber(p, 0));
	return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? missingAlpha];
}

/** Reads the name out of a texture default such as `"white" {}`. */
export function parseTextureDefault(text: string): BuiltinTexture | '' {
	const m = text.match(/^\s*"([^"]*)"/);
	const name = m?.[1].trim().toLowerCase() ?? '';
	return BUILTIN_TEXTURES.includes(name) ? (name as BuiltinTexture) : '';
}

function parseEnumArgs(args: string[]): Pick<EnumControl, 'options' | 'enumType'> {
	// `[Enum(UnityEngine.Rendering.CullMode)]`: a single type name.
	if (args.length === 1 && /^[A-Za-z_][\w.]*$/.test(args[0])) {
		const typeName = args[0];
		return { enumType: typeName, options: KNOWN_ENUM_TYPES[typeName.split('.').pop() ?? typeName] };
	}
	// `[Enum(Label, value, Label, value, ...)]`.
	const options: EnumOption[] = [];
	for (let i = 0; i + 1 < args.length; i += 2) {
		options.push({ label: args[i], value: parseNumber(args[i + 1], options.length) });
	}
	return { options };
}

/** Builds the Inspector control for one property, or an 'unknown' control for types we don't model. */
export function toControl(prop: ShaderProperty): PropertyControl {
	const attrs = prop.attributes.map(parseAttribute).filter((a): a is ParsedAttribute => a !== undefined);
	const find = (name: string) => attrs.find((a) => a.name === name);

	const base: ControlBase = {
		name: prop.name,
		label: prop.label,
		hidden: find('HideInInspector') !== undefined,
		perRendererData: find('PerRendererData') !== undefined,
		line: prop.line,
	};
	const header = find('Header');
	if (header) {
		base.header = header.args.join(', ');
	}
	const space = find('Space');
	if (space) {
		base.space = parseNumber(space.args[0], 8);
	}

	const type = prop.type.replace(/\s+/g, '');
	const lowerType = type.toLowerCase();
	const defaultNumber = parseNumber(prop.defaultValue, 0);

	const range = type.match(/^Range\(([^,]+),([^)]+)\)$/i);
	if (range) {
		const power = find('PowerSlider');
		return {
			...base, kind: 'range', min: parseNumber(range[1], 0), max: parseNumber(range[2], 1), defaultValue: defaultNumber,
			power: power ? parseNumber(power.args[0], 2) : undefined, integer: find('IntRange') !== undefined,
		};
	}

	if (lowerType === 'float' || lowerType === 'int' || lowerType === 'integer') {
		const keywordEnum = find('KeywordEnum');
		if (keywordEnum && keywordEnum.args.length > 0) {
			return {
				...base, kind: 'keywordEnum', defaultValue: defaultNumber,
				options: keywordEnum.args.map((label, value) => ({ label, value, keyword: keywordEnumKeyword(prop.name, label) })),
			};
		}
		const enumAttr = find('Enum');
		if (enumAttr) {
			return { ...base, kind: 'enum', defaultValue: defaultNumber, ...parseEnumArgs(enumAttr.args) };
		}
		const toggle = find('Toggle') ?? find('ToggleOff') ?? find('ToggleUI');
		if (toggle) {
			const keyword = toggle.name === 'ToggleUI' ? undefined : prop.drivenKeywords[0];
			return { ...base, kind: 'toggle', defaultValue: defaultNumber !== 0, keyword, invert: toggle.name === 'ToggleOff' };
		}
		return lowerType === 'float'
			? { ...base, kind: 'float', defaultValue: defaultNumber }
			: { ...base, kind: 'int', defaultValue: Math.trunc(defaultNumber) };
	}

	if (lowerType === 'color') {
		return {
			...base, kind: 'color', defaultValue: parseVec4(prop.defaultValue, 1),
			hdr: find('HDR') !== undefined, gamma: find('Gamma') !== undefined, isMainColor: find('MainColor') !== undefined,
		};
	}

	if (lowerType === 'vector') {
		return { ...base, kind: 'vector', defaultValue: parseVec4(prop.defaultValue), gamma: find('Gamma') !== undefined };
	}

	const dimension = TEXTURE_DIMENSIONS.find((d) => d.toLowerCase() === lowerType);
	if (dimension) {
		return {
			...base, kind: 'texture', dimension: dimension as TextureDimension, defaultTexture: parseTextureDefault(prop.defaultValue),
			scaleOffset: find('NoScaleOffset') === undefined, normalMap: find('Normal') !== undefined,
			isMainTexture: find('MainTexture') !== undefined,
		};
	}

	return { ...base, kind: 'unknown', rawType: prop.type };
}

/** Controls for every property, in declaration order. */
export function buildControls(properties: ShaderProperty[]): PropertyControl[] {
	return properties.map(toControl);
}
