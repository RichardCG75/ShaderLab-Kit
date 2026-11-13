// Pure helpers for material values: defaults from the typed property controls, merging stored values
// back in after the shader text changes, and the shader keywords the current values enable. Shared by
// the host (persistence) and the webview (inspector display).

import type { PropertyControl, Vec4 } from '../analysis/materialProperties';
import type { MaterialValue, MaterialValues, TextureSlotValue } from './protocol';

export function defaultTextureSlot(): TextureSlotValue {
	return { tiling: [1, 1], offset: [0, 0] };
}

/** The declared default of a control, or undefined for controls that hold no value. */
export function defaultValue(control: PropertyControl): MaterialValue | undefined {
	switch (control.kind) {
		case 'float': case 'int': case 'range': case 'enum': case 'keywordEnum':
			return control.defaultValue;
		case 'toggle':
			return control.defaultValue;
		case 'color': case 'vector':
			return [...control.defaultValue] as Vec4;
		case 'texture':
			return defaultTextureSlot();
		case 'unknown':
			return undefined;
	}
}

function isVec4(value: unknown): value is Vec4 {
	return Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function isPair(value: unknown): value is [number, number] {
	return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function isTextureSlot(value: unknown): value is TextureSlotValue {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const slot = value as Partial<TextureSlotValue>;
	return isPair(slot.tiling) && isPair(slot.offset) && (slot.path === undefined || typeof slot.path === 'string');
}

/** Whether `value` has the right shape for `control` (stored values may predate a type change). */
export function isValidValue(control: PropertyControl, value: unknown): value is MaterialValue {
	switch (control.kind) {
		case 'float': case 'int': case 'range': case 'enum': case 'keywordEnum':
			return typeof value === 'number' && Number.isFinite(value);
		case 'toggle':
			return typeof value === 'boolean';
		case 'color': case 'vector':
			return isVec4(value);
		case 'texture':
			return isTextureSlot(value);
		case 'unknown':
			return false;
	}
}

/** Values for every control: the stored value when it still fits the control, else the declared default. */
export function mergeValues(controls: PropertyControl[], stored: MaterialValues | undefined): MaterialValues {
	const values: MaterialValues = {};
	for (const control of controls) {
		const previous = stored?.[control.name];
		const value = previous !== undefined && isValidValue(control, previous) ? previous : defaultValue(control);
		if (value !== undefined) {
			values[control.name] = value;
		}
	}
	return values;
}

/** Shader keywords enabled by `[Toggle]` / `[ToggleOff]` / `[KeywordEnum]` properties at these values. */
export function activeKeywords(controls: PropertyControl[], values: MaterialValues): string[] {
	const keywords: string[] = [];
	for (const control of controls) {
		const value = values[control.name];
		if (control.kind === 'toggle' && control.keyword && typeof value === 'boolean') {
			if (value !== control.invert) {
				keywords.push(control.keyword);
			}
		} else if (control.kind === 'keywordEnum' && typeof value === 'number') {
			const option = control.options[Math.round(value)];
			if (option) {
				keywords.push(option.keyword);
			}
		}
	}
	return keywords;
}

/** A material value as a plain number (for `[_Prop]` render-state references), if it is one. */
export function numericValue(value: MaterialValue | undefined): number | undefined {
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'boolean') {
		return value ? 1 : 0;
	}
	return undefined;
}
