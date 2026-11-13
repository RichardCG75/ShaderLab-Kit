// The preview backend seam: turns a shader document into something the webview can draw. The MVP
// ships only the stock-material backend (stockMaterialBackend.ts). Later backends (a restricted
// HLSL->GLSL translator, a Unity Editor bridge) implement the same interface; see
// docs/preview-feature-design.md §3.

import type { PropertyControl } from '../analysis/materialProperties';
import type { PreviewProgram, Unsupported } from './protocol';

export interface PreviewRequest {
	text: string;
	fileName: string;
	controls: PropertyControl[];
}

export type PreviewResult = { ok: true; program: PreviewProgram } | { ok: false; unsupported: Unsupported };

export interface PreviewBackend {
	readonly id: string;
	compile(request: PreviewRequest): Promise<PreviewResult>;
}
