// Shader preview panel (extension-host side): a singleton webview beside the editor that shows the
// active .shader file on a mesh with an Inspector-style material editor. This side owns document
// tracking, live refresh, persistence (workspaceState) and file access; rendering happens in the
// webview bundle (src/webview/main.ts, built to dist/webview.js). See docs/preview-feature-design.md.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildControls, type PropertyControl } from '../analysis/materialProperties';
import { extractSymbols } from '../analysis/shaderSymbols';
import type { PreviewBackend } from '../preview/backend';
import { mergeValues } from '../preview/materialValues';
import {
	DEFAULT_SCENE, MESH_KINDS, type HostToWebviewMessage, type MaterialValues, type ResolvedTexture, type SceneSettings,
	type TextureSlotValue, type WebviewPersistedState, type WebviewToHostMessage,
} from '../preview/protocol';
import { stockMaterialBackend } from '../preview/stockMaterialBackend';

const VIEW_TYPE = 'shaderlabKit.preview';
const MATERIAL_KEY_PREFIX = 'shaderlabKit.preview.material:';
const SCENE_KEY = 'shaderlabKit.preview.scene';
const MAX_TEXTURE_BYTES = 32 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

let output: vscode.OutputChannel | undefined;
function log(message: string): void {
	output ??= vscode.window.createOutputChannel('ShaderLab Kit Preview');
	output.appendLine(`[${new Date().toISOString()}] ${message}`);
}

/** Whether a document is something the preview can show (a ShaderLab file, not an HLSL include). */
export function isPreviewableDocument(document: vscode.TextDocument): boolean {
	return document.uri.scheme !== 'output' && (document.languageId === 'shaderlab' || document.fileName.toLowerCase().endsWith('.shader'));
}

function getRefreshDelay(): number {
	const delay = vscode.workspace.getConfiguration('shaderlabKit.preview').get<number>('refreshDelay', 400);
	return Math.max(0, Math.min(5000, delay));
}

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let result = '';
	for (let i = 0; i < 32; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
}

function sanitizeScene(value: unknown): SceneSettings {
	const scene = { ...DEFAULT_SCENE };
	if (typeof value !== 'object' || value === null) {
		return scene;
	}
	const v = value as Partial<Record<keyof SceneSettings, unknown>>;
	const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
	scene.mesh = MESH_KINDS.includes(v.mesh as SceneSettings['mesh']) ? (v.mesh as SceneSettings['mesh']) : scene.mesh;
	scene.lightAzimuth = num(v.lightAzimuth, scene.lightAzimuth);
	scene.lightElevation = num(v.lightElevation, scene.lightElevation);
	scene.lightIntensity = num(v.lightIntensity, scene.lightIntensity);
	scene.ambientIntensity = num(v.ambientIntensity, scene.ambientIntensity);
	scene.background = typeof v.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.background) ? v.background : scene.background;
	scene.wireframe = typeof v.wireframe === 'boolean' ? v.wireframe : scene.wireframe;
	scene.autoRotate = typeof v.autoRotate === 'boolean' ? v.autoRotate : scene.autoRotate;
	return scene;
}

/** Reads a texture for the webview; `known` holds keys the webview already decoded (data is then omitted). */
async function loadTexture(filePath: string, known?: Set<string>): Promise<ResolvedTexture> {
	const label = path.basename(filePath);
	const mimeType = IMAGE_TYPES[path.extname(filePath).toLowerCase()];
	if (!mimeType) {
		return { label, error: `${path.extname(filePath) || 'This'} format can't be decoded by the preview; use PNG, JPEG, WebP, GIF or BMP.` };
	}
	try {
		const stat = await fs.stat(filePath);
		if (stat.size > MAX_TEXTURE_BYTES) {
			return { label, error: `File is larger than ${MAX_TEXTURE_BYTES / (1024 * 1024)} MB.` };
		}
		const key = `${filePath}:${stat.mtimeMs}:${stat.size}`;
		if (known?.has(key)) {
			return { label, mimeType, key };
		}
		const data = new Uint8Array(await fs.readFile(filePath));
		known?.add(key);
		return { label, data, mimeType, key };
	} catch {
		return { label, error: 'File not found or unreadable.' };
	}
}

class ShaderPreviewPanel {
	static current: ShaderPreviewPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private documentUri: vscode.Uri | undefined;
	private controls: PropertyControl[] = [];
	private values: MaterialValues = {};
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	/** Incremented per refresh so a slow, stale refresh never overwrites a newer one. */
	private refreshId = 0;
	private webviewReady = false;
	/** Texture keys already sent to the current webview instance (reset when it reloads). */
	private sentTextureKeys = new Set<string>();
	private disposed = false;

	constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly context: vscode.ExtensionContext,
		private readonly backend: PreviewBackend,
	) {
		const extensionUri = context.extensionUri;
		panel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist'), vscode.Uri.joinPath(extensionUri, 'media')],
		};
		panel.iconPath = vscode.Uri.joinPath(extensionUri, 'assets', 'icon.png');
		panel.webview.html = this.html();

		this.disposables.push(
			panel.onDidDispose(() => this.dispose()),
			panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => this.onMessage(message)),
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (this.isCurrent(event.document) && event.contentChanges.length > 0) {
					this.scheduleRefresh(getRefreshDelay());
				}
			}),
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (this.isCurrent(document)) {
					this.scheduleRefresh(0);
				}
			}),
			vscode.window.onDidChangeActiveTextEditor((editor) => {
				if (editor && isPreviewableDocument(editor.document) && !this.isCurrent(editor.document)) {
					this.show(editor.document.uri, false);
				}
			}),
		);
	}

	private isCurrent(document: vscode.TextDocument): boolean {
		return this.documentUri !== undefined && document.uri.toString() === this.documentUri.toString();
	}

	show(uri: vscode.Uri, reveal: boolean): void {
		this.documentUri = uri;
		this.panel.title = `Preview: ${path.basename(uri.fsPath)}`;
		if (reveal) {
			this.panel.reveal(vscode.ViewColumn.Beside, true);
		}
		this.scheduleRefresh(0);
	}

	private scheduleRefresh(delay: number): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh();
		}, delay);
	}

	private materialKey(): string | undefined {
		return this.documentUri ? MATERIAL_KEY_PREFIX + this.documentUri.toString() : undefined;
	}

	private storedValues(): MaterialValues | undefined {
		const key = this.materialKey();
		return key ? this.context.workspaceState.get<MaterialValues>(key) : undefined;
	}

	private async saveValues(): Promise<void> {
		const key = this.materialKey();
		if (key) {
			await this.context.workspaceState.update(key, this.values);
		}
	}

	private scene(): SceneSettings {
		return sanitizeScene(this.context.workspaceState.get(SCENE_KEY));
	}

	private async refresh(): Promise<void> {
		const uri = this.documentUri;
		if (!uri || !this.webviewReady) {
			return;
		}
		const id = ++this.refreshId;
		let document: vscode.TextDocument;
		try {
			document = await vscode.workspace.openTextDocument(uri);
		} catch (error) {
			log(`Could not open ${uri.toString()}: ${String(error)}`);
			return;
		}
		const text = document.getText();
		const controls = buildControls(extractSymbols(text).properties);
		const result = await this.backend.compile({ text, fileName: document.fileName, controls });
		const values = mergeValues(controls, this.storedValues());
		const textures: Record<string, ResolvedTexture> = {};
		await Promise.all(Object.entries(values).map(async ([name, value]) => {
			if (typeof value === 'object' && !Array.isArray(value) && value.path) {
				textures[name] = await loadTexture(value.path, this.sentTextureKeys);
			}
		}));
		if (id !== this.refreshId) {
			return;
		}
		this.controls = controls;
		this.values = values;
		this.post({
			type: 'update', documentUri: uri.toString(), fileName: path.basename(document.fileName), controls, values, textures,
			program: result.ok ? result.program : undefined, unsupported: result.ok ? undefined : result.unsupported,
			scene: this.scene(),
		});
	}

	private post(message: HostToWebviewMessage): void {
		void this.panel.webview.postMessage(message);
	}

	private async onMessage(message: WebviewToHostMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				this.webviewReady = true;
				this.sentTextureKeys = new Set();
				this.scheduleRefresh(0);
				break;
			case 'propertyChanged': {
				const control = this.controls.find((c) => c.name === message.name);
				if (!control) {
					break;
				}
				const previous = this.values[message.name];
				// Texture slots: the webview edits tiling/offset; the file path stays host-owned.
				if (control.kind === 'texture' && typeof message.value === 'object' && !Array.isArray(message.value)) {
					const slot = previous as TextureSlotValue | undefined;
					this.values[message.name] = { ...message.value, path: slot?.path };
				} else {
					this.values[message.name] = message.value;
				}
				this.values = mergeValues(this.controls, this.values);
				await this.saveValues();
				break;
			}
			case 'chooseTexture':
				await this.chooseTexture(message.name);
				break;
			case 'clearTexture': {
				const slot = this.values[message.name] as TextureSlotValue | undefined;
				if (slot && typeof slot === 'object') {
					const value: TextureSlotValue = { tiling: slot.tiling, offset: slot.offset };
					this.values[message.name] = value;
					await this.saveValues();
					this.post({ type: 'setTexture', name: message.name, value, texture: {} });
				}
				break;
			}
			case 'resetProperties': {
				const key = this.materialKey();
				if (key) {
					await this.context.workspaceState.update(key, undefined);
				}
				this.scheduleRefresh(0);
				break;
			}
			case 'sceneChanged':
				await this.context.workspaceState.update(SCENE_KEY, sanitizeScene(message.scene));
				break;
			case 'log':
				log(`webview ${message.level}: ${message.message}`);
				if (message.level === 'error') {
					void vscode.window.showErrorMessage(`Shader preview: ${message.message}`);
				}
				break;
		}
	}

	private async chooseTexture(name: string): Promise<void> {
		const slot = this.values[name] as TextureSlotValue | undefined;
		if (!slot || typeof slot !== 'object') {
			return;
		}
		const base = slot.path ? vscode.Uri.file(path.dirname(slot.path))
			: this.documentUri ? vscode.Uri.joinPath(this.documentUri, '..') : undefined;
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false, defaultUri: base, openLabel: 'Use Texture',
			filters: { Images: Object.keys(IMAGE_TYPES).map((ext) => ext.slice(1)) },
		});
		const file = picked?.[0];
		if (!file) {
			return;
		}
		const value: TextureSlotValue = { ...slot, path: file.fsPath };
		this.values[name] = value;
		await this.saveValues();
		this.post({ type: 'setTexture', name, value, texture: await loadTexture(file.fsPath, this.sentTextureKeys) });
	}

	private html(): string {
		const webview = this.panel.webview;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'));
		const scriptNonce = nonce();
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} data: blob:`,
			`style-src ${webview.cspSource}`,
			`font-src ${webview.cspSource}`,
			`script-src 'nonce-${scriptNonce}'`,
		].join('; ');
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="${csp}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri.toString()}">
	<title>Shader Preview</title>
</head>
<body>
	<div id="app"></div>
	<script nonce="${scriptNonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		if (ShaderPreviewPanel.current === this) {
			ShaderPreviewPanel.current = undefined;
		}
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}
		this.panel.dispose();
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}
}

function openPreview(context: vscode.ExtensionContext, uri?: vscode.Uri): void {
	const document = uri ? undefined : vscode.window.activeTextEditor?.document;
	const target = uri ?? (document && isPreviewableDocument(document) ? document.uri : undefined);
	if (!target) {
		void vscode.window.showInformationMessage('Open a .shader file to preview it.');
		return;
	}
	if (ShaderPreviewPanel.current) {
		ShaderPreviewPanel.current.show(target, true);
		return;
	}
	const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Shader Preview', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
		enableScripts: true,
	});
	ShaderPreviewPanel.current = new ShaderPreviewPanel(panel, context, stockMaterialBackend);
	ShaderPreviewPanel.current.show(target, false);
}

export function registerPreviewPanel(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('shaderlabKit.preview.open', (uri?: unknown) =>
			openPreview(context, uri instanceof vscode.Uri ? uri : undefined)),
		vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
			async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown) {
				const documentUri = (state as WebviewPersistedState | undefined)?.documentUri;
				ShaderPreviewPanel.current?.dispose();
				ShaderPreviewPanel.current = new ShaderPreviewPanel(panel, context, stockMaterialBackend);
				if (documentUri) {
					ShaderPreviewPanel.current.show(vscode.Uri.parse(documentUri), false);
				}
			},
		}),
		{ dispose: () => ShaderPreviewPanel.current?.dispose() },
	);
}
