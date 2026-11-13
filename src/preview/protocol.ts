// Message protocol between the extension host (src/providers/previewPanel.ts) and the preview
// webview (src/webview/main.ts). Shared by both bundles, so it must stay free of `vscode` and DOM
// imports. Every message is a plain JSON object with a `type` discriminant.

import type { PropertyControl, Vec4 } from '../analysis/materialProperties';
import type { RawRenderState } from '../analysis/shaderStructure';

export type MeshKind = 'sphere' | 'cube' | 'plane' | 'cylinder' | 'torus';
export const MESH_KINDS: readonly MeshKind[] = ['sphere', 'cube', 'plane', 'cylinder', 'torus'];

/** A texture slot's material-side value. `path` is an absolute file path; absent means the built-in default. */
export interface TextureSlotValue {
	path?: string;
	tiling: [number, number];
	offset: [number, number];
}

/** number: Float/Int/Range/Enum/KeywordEnum · boolean: Toggle · Vec4: Color/Vector · texture slot. */
export type MaterialValue = number | boolean | Vec4 | TextureSlotValue;
export type MaterialValues = Record<string, MaterialValue>;

/**
 * A texture's file contents, sent as bytes so the webview can decode it from a same-origin Blob
 * (resource URLs are cross-origin to the webview and could taint WebGL uploads).
 */
export interface ResolvedTexture {
	data?: Uint8Array;
	mimeType?: string;
	/**
	 * Identifies the file version (path, mtime, size). When the webview already holds this key the host
	 * omits `data`, so unchanged textures are neither re-sent nor re-decoded on every refresh.
	 */
	key?: string;
	/** File name shown in the inspector. */
	label?: string;
	/** Why the file could not be loaded (missing, unsupported format, too large). */
	error?: string;
}

export interface SceneSettings {
	mesh: MeshKind;
	/** Directional light direction, in degrees. */
	lightAzimuth: number;
	lightElevation: number;
	lightIntensity: number;
	ambientIntensity: number;
	/** CSS hex color, e.g. `#303030`. */
	background: string;
	wireframe: boolean;
	autoRotate: boolean;
}

export const DEFAULT_SCENE: SceneSettings = {
	mesh: 'sphere', lightAzimuth: 45, lightElevation: 40, lightIntensity: 2.5, ambientIntensity: 0.6,
	background: '#2b2b2b', wireframe: false, autoRotate: false,
};

/** Property names the stock material reads, by role. Each is optional. */
export interface MaterialSlots {
	baseColor?: string;
	baseMap?: string;
	normalMap?: string;
	normalScale?: string;
	metallic?: string;
	smoothness?: string;
	emissionColor?: string;
	emissionMap?: string;
	cutoff?: string;
	/** Toggle property that enables alpha clipping; when absent, `alwaysClip` decides. */
	alphaClip?: string;
	alwaysClip?: boolean;
}

/** What the webview should draw for the current shader. */
export interface PreviewProgram {
	backend: 'stock';
	model: 'unlit' | 'lit';
	passName: string;
	lightMode: string;
	slots: MaterialSlots;
	renderState: RawRenderState;
	/** Visible properties the preview uses / ignores, for the "approximate preview" banner. */
	mapped: string[];
	unmapped: string[];
	notes: string[];
}

export interface Unsupported {
	reason: string;
	/** 0-based line the reason points at, if any. */
	line?: number;
}

// ---- host -> webview ----

export interface UpdateMessage {
	type: 'update';
	documentUri: string;
	fileName: string;
	controls: PropertyControl[];
	values: MaterialValues;
	textures: Record<string, ResolvedTexture>;
	program?: PreviewProgram;
	unsupported?: Unsupported;
	scene: SceneSettings;
}

export interface SetTextureMessage {
	type: 'setTexture';
	name: string;
	value: TextureSlotValue;
	texture: ResolvedTexture;
}

export type HostToWebviewMessage = UpdateMessage | SetTextureMessage;

// ---- webview -> host ----

export type WebviewToHostMessage =
	| { type: 'ready' }
	| { type: 'propertyChanged'; name: string; value: MaterialValue }
	| { type: 'chooseTexture'; name: string }
	| { type: 'clearTexture'; name: string }
	| { type: 'resetProperties' }
	| { type: 'sceneChanged'; scene: SceneSettings }
	| { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

/** Persisted in the webview's `vscode.setState` so a restored panel knows its document. */
export interface WebviewPersistedState {
	documentUri?: string;
}
