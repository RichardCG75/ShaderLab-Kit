// Entry point of the shader preview webview (bundled to dist/webview.js). Builds the layout
// (toolbar, viewport, notice banner, inspector), wires it to the three.js scene and the material
// binder, and talks to the extension host through the protocol in src/preview/protocol.ts.

import { DEFAULT_SCENE, MESH_KINDS, type HostToWebviewMessage, type SceneSettings, type UpdateMessage } from '../preview/protocol';
import { Inspector } from './inspector';
import { MaterialBinder } from './material';
import { PreviewScene } from './scene';
import { post, vscodeApi } from './vscodeApi';

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

const app = document.getElementById('app') as HTMLElement;
const stage = el('div', 'stage');
const toolbar = el('div', 'toolbar');
const viewport = el('div', 'viewport');
const banner = el('div', 'banner');
const inspectorRoot = el('div', 'inspector');
stage.append(toolbar, viewport, banner);
app.append(stage, inspectorRoot);

let scene: PreviewScene | undefined;
let settings: SceneSettings = { ...DEFAULT_SCENE };

function reportError(message: string): void {
	post({ type: 'log', level: 'warn', message });
}

try {
	scene = new PreviewScene(viewport);
} catch (error) {
	viewport.append(el('div', 'error viewport-error', 'WebGL is not available, so the 3D preview cannot be drawn. The material inspector still works.'));
	post({ type: 'log', level: 'error', message: `WebGL initialisation failed: ${String(error)}` });
}

const binder = new MaterialBinder((material) => scene?.setMaterial(material), reportError);

const inspector = new Inspector(inspectorRoot, {
	onChange: (name, value) => {
		binder.setValue(name, value);
		post({ type: 'propertyChanged', name, value });
	},
	onChooseTexture: (name) => post({ type: 'chooseTexture', name }),
	onClearTexture: (name) => post({ type: 'clearTexture', name }),
	onReset: () => post({ type: 'resetProperties' }),
});

// ---- toolbar ----

let sceneSaveTimer: ReturnType<typeof setTimeout> | undefined;
function updateSettings(patch: Partial<SceneSettings>): void {
	settings = { ...settings, ...patch };
	scene?.applySettings(settings);
	binder.setWireframe(settings.wireframe);
	// Sliders fire continuously; persist once they settle.
	if (sceneSaveTimer) {
		clearTimeout(sceneSaveTimer);
	}
	sceneSaveTimer = setTimeout(() => post({ type: 'sceneChanged', scene: settings }), 300);
}

const meshSelect = el('select');
meshSelect.title = 'Preview mesh';
for (const kind of MESH_KINDS) {
	const option = el('option', undefined, kind[0].toUpperCase() + kind.slice(1));
	option.value = kind;
	meshSelect.append(option);
}
meshSelect.addEventListener('change', () => updateSettings({ mesh: meshSelect.value as SceneSettings['mesh'] }));

function slider(label: string, min: number, max: number, step: number, key: 'lightAzimuth' | 'lightElevation' | 'lightIntensity' | 'ambientIntensity'): HTMLElement {
	const wrap = el('label', 'tool');
	wrap.append(el('span', 'muted small', label));
	const input = el('input');
	input.type = 'range';
	input.min = String(min);
	input.max = String(max);
	input.step = String(step);
	input.dataset['key'] = key;
	input.addEventListener('input', () => updateSettings({ [key]: Number(input.value) }));
	wrap.append(input);
	return wrap;
}

function checkbox(label: string, key: 'wireframe' | 'autoRotate'): HTMLElement {
	const wrap = el('label', 'tool');
	const input = el('input');
	input.type = 'checkbox';
	input.dataset['key'] = key;
	input.addEventListener('change', () => updateSettings({ [key]: input.checked }));
	wrap.append(input, el('span', 'small', label));
	return wrap;
}

const background = el('input');
background.type = 'color';
background.title = 'Background color';
background.addEventListener('input', () => updateSettings({ background: background.value }));

const resetView = el('button', 'secondary', 'Reset view');
resetView.addEventListener('click', () => scene?.resetView());

toolbar.append(
	meshSelect,
	slider('Light ↻', -180, 180, 1, 'lightAzimuth'),
	slider('Light ↕', -10, 90, 1, 'lightElevation'),
	slider('Light', 0, 6, 0.05, 'lightIntensity'),
	slider('Ambient', 0, 2, 0.05, 'ambientIntensity'),
	checkbox('Wireframe', 'wireframe'),
	checkbox('Rotate', 'autoRotate'),
	background,
	resetView,
);

function syncToolbar(): void {
	meshSelect.value = settings.mesh;
	background.value = settings.background;
	for (const input of toolbar.querySelectorAll<HTMLInputElement>('input[data-key]')) {
		const value = settings[input.dataset['key'] as keyof SceneSettings];
		if (input.type === 'checkbox') {
			input.checked = value === true;
		} else {
			input.value = String(value);
		}
	}
}

// ---- notice banner ----

function renderBanner(message: UpdateMessage): void {
	banner.replaceChildren();
	if (message.unsupported) {
		const line = message.unsupported.line !== undefined ? ` (line ${message.unsupported.line + 1})` : '';
		banner.append(el('div', 'error', `Preview unavailable${line}: ${message.unsupported.reason}`));
		return;
	}
	const program = message.program;
	if (!program) {
		return;
	}
	const pass = [program.passName && `“${program.passName}”`, program.lightMode && `LightMode ${program.lightMode}`].filter((s) => s).join(', ');
	banner.append(el('div', 'notice',
		`Approximate preview of ${message.fileName}: the shader's HLSL is not executed. Drawn as ${program.model}${pass ? `, from pass ${pass}` : ''}.`));
	if (program.mapped.length) {
		banner.append(el('div', 'small', `Previewed: ${program.mapped.join(', ')}`));
	}
	if (program.unmapped.length) {
		banner.append(el('div', 'small muted', `Not previewed: ${program.unmapped.join(', ')}`));
	}
	for (const note of program.notes) {
		banner.append(el('div', 'small muted', note));
	}
}

// ---- host messages ----

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
	const message = event.data;
	switch (message.type) {
		case 'update':
			vscodeApi.setState({ documentUri: message.documentUri });
			settings = { ...message.scene };
			syncToolbar();
			scene?.applySettings(settings);
			binder.setWireframe(settings.wireframe);
			binder.setShader(message.program, message.controls, message.values, message.textures);
			inspector.render(message.controls, message.values, message.textures);
			renderBanner(message);
			break;
		case 'setTexture':
			binder.setValue(message.name, message.value);
			void binder.setTexture(message.name, message.texture);
			inspector.setTexture(message.name, message.value, message.texture);
			break;
	}
});

syncToolbar();
post({ type: 'ready' });
