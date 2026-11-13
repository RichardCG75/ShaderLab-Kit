// Typed wrapper over the API VS Code injects into webviews.

import type { WebviewPersistedState, WebviewToHostMessage } from '../preview/protocol';

interface VsCodeApi {
	postMessage(message: WebviewToHostMessage): void;
	getState(): WebviewPersistedState | undefined;
	setState(state: WebviewPersistedState): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** May only be acquired once per webview, so the module keeps the single instance. */
export const vscodeApi: VsCodeApi = acquireVsCodeApi();

export function post(message: WebviewToHostMessage): void {
	vscodeApi.postMessage(message);
}
