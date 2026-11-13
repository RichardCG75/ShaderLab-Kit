// Inspector-style material editor: one row per material property, built from the typed controls
// (src/analysis/materialProperties.ts). All text from the shader is set with textContent, never as HTML.

import type {
	ColorControl, EnumControl, KeywordEnumControl, PropertyControl, RangeControl, TextureControl, ToggleControl, Vec4, VectorControl,
} from '../analysis/materialProperties';
import { activeKeywords } from '../preview/materialValues';
import type { MaterialValue, MaterialValues, ResolvedTexture, TextureSlotValue } from '../preview/protocol';

export interface InspectorCallbacks {
	onChange(name: string, value: MaterialValue): void;
	onChooseTexture(name: string): void;
	onClearTexture(name: string): void;
	onReset(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const element = document.createElement(tag);
	if (className) {
		element.className = className;
	}
	if (text !== undefined) {
		element.textContent = text;
	}
	return element;
}

function numberInput(value: number, step: number | 'any', onValue: (v: number) => void): HTMLInputElement {
	const input = el('input', 'number');
	input.type = 'number';
	input.step = String(step);
	input.value = String(value);
	input.addEventListener('input', () => {
		const v = Number(input.value);
		if (input.value.trim() !== '' && Number.isFinite(v)) {
			onValue(v);
		}
	});
	return input;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function toHex(rgb: [number, number, number]): string {
	return '#' + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** HDR colors are shown as a [0,1] base color plus an exposure in stops: value = base × 2^ev. */
function splitHdr(color: Vec4): { base: [number, number, number]; ev: number } {
	const max = Math.max(color[0], color[1], color[2]);
	if (max <= 1) {
		return { base: [color[0], color[1], color[2]], ev: 0 };
	}
	return { base: [color[0] / max, color[1] / max, color[2] / max], ev: Math.log2(max) };
}

export class Inspector {
	private controls: PropertyControl[] = [];
	private values: MaterialValues = {};
	private readonly textureInfo = new Map<string, HTMLElement>();
	private readonly list = el('div', 'inspector-list');
	private readonly keywords = el('div', 'inspector-keywords');

	constructor(private readonly root: HTMLElement, private readonly callbacks: InspectorCallbacks) {
		const header = el('div', 'inspector-header');
		header.append(el('span', 'inspector-title', 'Material'));
		const reset = el('button', 'secondary', 'Reset');
		reset.title = 'Reset every property to the default declared in the shader';
		reset.addEventListener('click', () => callbacks.onReset());
		header.append(reset);
		root.append(header, this.list, this.keywords);
	}

	render(controls: PropertyControl[], values: MaterialValues, textures: Record<string, ResolvedTexture>): void {
		this.controls = controls;
		this.values = { ...values };
		this.textureInfo.clear();
		this.list.replaceChildren();
		const visible = controls.filter((c) => !c.hidden);
		if (visible.length === 0) {
			this.list.append(el('div', 'muted', 'This shader declares no material properties.'));
		}
		for (const control of visible) {
			if (control.header) {
				const header = el('div', 'property-header', control.header);
				if (control.space) {
					header.style.marginTop = `${control.space}px`;
				}
				this.list.append(header);
			}
			const row = el('div', 'property');
			if (control.space && !control.header) {
				row.style.marginTop = `${control.space}px`;
			}
			const label = el('label', 'property-label', control.label || control.name);
			label.title = control.name;
			row.append(label, this.editor(control, textures[control.name]));
			this.list.append(row);
		}
		this.renderKeywords();
	}

	/** Updates a texture slot after the host loaded (or cleared) its file. */
	setTexture(name: string, value: TextureSlotValue, texture: ResolvedTexture): void {
		this.values[name] = value;
		const info = this.textureInfo.get(name);
		const control = this.controls.find((c) => c.name === name);
		if (info && control?.kind === 'texture') {
			this.fillTextureInfo(info, control, texture);
		}
	}

	private change(name: string, value: MaterialValue): void {
		this.values[name] = value;
		this.callbacks.onChange(name, value);
		this.renderKeywords();
	}

	private renderKeywords(): void {
		const active = activeKeywords(this.controls, this.values);
		this.keywords.replaceChildren();
		if (this.controls.some((c) => (c.kind === 'toggle' && c.keyword) || c.kind === 'keywordEnum')) {
			this.keywords.append(el('div', 'muted', active.length ? `Keywords on: ${active.join(' ')}` : 'Keywords on: none'));
			this.keywords.append(el('div', 'muted small', 'Keywords are shown for reference; the preview does not compile shader variants.'));
		}
	}

	private editor(control: PropertyControl, texture: ResolvedTexture | undefined): HTMLElement {
		const value = this.values[control.name];
		switch (control.kind) {
			case 'float':
				return numberInput(value as number, 'any', (v) => this.change(control.name, v));
			case 'int':
				return numberInput(value as number, 1, (v) => this.change(control.name, Math.round(v)));
			case 'range':
				return this.rangeEditor(control, value as number);
			case 'color':
				return this.colorEditor(control, value as Vec4);
			case 'vector':
				return this.vectorEditor(control, value as Vec4);
			case 'toggle':
				return this.toggleEditor(control, value as boolean);
			case 'enum':
			case 'keywordEnum':
				return this.enumEditor(control, value as number);
			case 'texture':
				return this.textureEditor(control, value as TextureSlotValue, texture);
			case 'unknown':
				return el('span', 'muted', `${control.rawType} (not editable)`);
		}
	}

	private rangeEditor(control: RangeControl, value: number): HTMLElement {
		const wrap = el('div', 'range');
		const span = control.max - control.min;
		const power = control.power ?? 1;
		// The slider runs over t in [0, 1]; value = min + span * t^power ([PowerSlider]).
		const toT = (v: number) => (span === 0 ? 0 : Math.pow(clamp01((v - control.min) / span), 1 / power));
		const fromT = (t: number) => control.min + span * Math.pow(t, power);
		const slider = el('input');
		slider.type = 'range';
		slider.min = '0';
		slider.max = '1';
		slider.step = control.integer && span > 0 ? String(1 / span) : '0.001';
		slider.value = String(toT(value));
		const box = numberInput(value, control.integer ? 1 : 'any', (v) => {
			slider.value = String(toT(v));
			this.change(control.name, v);
		});
		slider.addEventListener('input', () => {
			let v = fromT(Number(slider.value));
			v = control.integer ? Math.round(v) : Number(v.toFixed(4));
			box.value = String(v);
			this.change(control.name, v);
		});
		wrap.append(slider, box);
		return wrap;
	}

	private colorEditor(control: ColorControl, value: Vec4): HTMLElement {
		const wrap = el('div', 'color');
		const { base, ev } = control.hdr ? splitHdr(value) : { base: [value[0], value[1], value[2]] as [number, number, number], ev: 0 };
		let current = { base, ev, alpha: value[3] };
		const emit = () => {
			const scale = Math.pow(2, current.ev);
			this.change(control.name, [current.base[0] * scale, current.base[1] * scale, current.base[2] * scale, current.alpha]);
		};
		const picker = el('input');
		picker.type = 'color';
		picker.value = toHex(base);
		picker.addEventListener('input', () => {
			current = { ...current, base: fromHex(picker.value) };
			emit();
		});
		const alpha = numberInput(Number(value[3].toFixed(3)), 0.01, (v) => {
			current = { ...current, alpha: clamp01(v) };
			emit();
		});
		alpha.title = 'Alpha';
		alpha.min = '0';
		alpha.max = '1';
		wrap.append(picker, el('span', 'muted small', 'A'), alpha);
		if (control.hdr) {
			const intensity = numberInput(Number(ev.toFixed(2)), 0.1, (v) => {
				current = { ...current, ev: v };
				emit();
			});
			intensity.title = 'HDR intensity in stops (value = color × 2^intensity)';
			wrap.append(el('span', 'muted small', 'HDR'), intensity);
		}
		return wrap;
	}

	private vectorEditor(control: VectorControl, value: Vec4): HTMLElement {
		const wrap = el('div', 'vector');
		const current: Vec4 = [...value];
		['X', 'Y', 'Z', 'W'].forEach((axis, i) => {
			const input = numberInput(current[i], 'any', (v) => {
				current[i] = v;
				this.change(control.name, [...current]);
			});
			input.title = axis;
			wrap.append(input);
		});
		return wrap;
	}

	private toggleEditor(control: ToggleControl, value: boolean): HTMLElement {
		const wrap = el('div', 'toggle');
		const box = el('input');
		box.type = 'checkbox';
		box.checked = value;
		box.addEventListener('change', () => this.change(control.name, box.checked));
		wrap.append(box);
		if (control.keyword) {
			wrap.append(el('span', 'muted small', control.invert ? `${control.keyword} when off` : control.keyword));
		}
		return wrap;
	}

	private enumEditor(control: EnumControl | KeywordEnumControl, value: number): HTMLElement {
		if (!control.options || control.options.length === 0) {
			const input = numberInput(value, 1, (v) => this.change(control.name, v));
			if (control.kind === 'enum' && control.enumType) {
				input.title = `${control.enumType} (values not known to the preview)`;
			}
			return input;
		}
		const select = el('select');
		for (const option of control.options) {
			const item = el('option', undefined, option.label);
			item.value = String(option.value);
			select.append(item);
		}
		select.value = String(value);
		if (select.selectedIndex === -1 && control.options[0]) {
			select.selectedIndex = 0;
		}
		select.addEventListener('change', () => this.change(control.name, Number(select.value)));
		return select;
	}

	private textureEditor(control: TextureControl, value: TextureSlotValue, texture: ResolvedTexture | undefined): HTMLElement {
		const wrap = el('div', 'texture');
		const info = el('div', 'texture-info');
		this.textureInfo.set(control.name, info);
		this.fillTextureInfo(info, control, texture);
		wrap.append(info);

		if (control.dimension !== '2D') {
			wrap.append(el('div', 'muted small', `${control.dimension} textures are not previewed yet.`));
			return wrap;
		}
		const buttons = el('div', 'texture-buttons');
		const choose = el('button', 'secondary', 'Choose…');
		choose.addEventListener('click', () => this.callbacks.onChooseTexture(control.name));
		const clear = el('button', 'secondary', 'Clear');
		clear.addEventListener('click', () => this.callbacks.onClearTexture(control.name));
		buttons.append(choose, clear);
		wrap.append(buttons);

		if (control.scaleOffset) {
			const grid = el('div', 'scale-offset');
			const slot: TextureSlotValue = { ...value, tiling: [...value.tiling], offset: [...value.offset] };
			const emit = () => {
				const current = this.values[control.name] as TextureSlotValue;
				this.change(control.name, { ...current, tiling: [...slot.tiling], offset: [...slot.offset] });
			};
			const pair = (label: string, target: [number, number]) => {
				grid.append(el('span', 'muted small', label));
				target.forEach((v, i) => grid.append(numberInput(v, 'any', (n) => {
					target[i] = n;
					emit();
				})));
			};
			pair('Tiling', slot.tiling);
			pair('Offset', slot.offset);
			wrap.append(grid);
		}
		return wrap;
	}

	private fillTextureInfo(info: HTMLElement, control: TextureControl, texture: ResolvedTexture | undefined): void {
		info.replaceChildren();
		const tags = [control.normalMap ? 'normal map' : '', control.isMainTexture ? 'main' : ''].filter((t) => t);
		const name = texture?.label ?? `Default: ${control.defaultTexture || 'gray'}`;
		info.append(el('span', texture?.label ? '' : 'muted', name));
		if (tags.length) {
			info.append(el('span', 'muted small', ` (${tags.join(', ')})`));
		}
		if (texture?.error) {
			info.append(el('div', 'error small', texture.error));
		}
	}
}
