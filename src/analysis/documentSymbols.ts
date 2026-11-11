// vscode-side symbol service: extracts symbols from the open document and (recursively) from its
// project-local `#include` files, caching per document version / file mtime. Package-cache and Unity
// Editor includes are skipped on purpose — they are covered by the curated URP data and are large.

import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { resolveInclude } from '../unity/includeResolver';
import { ShaderSymbols, extractSymbols, mergeSymbols } from './shaderSymbols';

const MAX_INCLUDE_DEPTH = 3;
const MAX_INCLUDE_FILES = 24;
const MAX_INCLUDE_BYTES = 512 * 1024;
const KNOWN_PACKAGE_INCLUDE = /^Packages[\\/]com\.unity\.(render-pipelines\.(universal|core)|shadergraph)[\\/]/;
const SKIPPED_PATH_PATTERN = /(PackageCache|[\\/]Editor[\\/]Data[\\/]|PackageManager)/;

export interface SymbolOrigin {
	/** Absolute file path; undefined means the open document itself. */
	file?: string;
	line: number;
}

export interface ResolvedSymbols {
	/** Open document only. */
	local: ShaderSymbols;
	/** Open document + local includes. */
	all: ShaderSymbols;
	/** Where each function/macro/struct was declared. */
	origins: Map<string, SymbolOrigin>;
	/** True when an include could not be inspected (package / unresolved), so absence of a symbol proves nothing. */
	hasOpaqueIncludes: boolean;
}

const includeCache = new Map<string, { mtimeMs: number; symbols: ShaderSymbols }>();
const documentCache = new Map<string, { version: number; result: ResolvedSymbols }>();

async function loadIncludeSymbols(absolutePath: string): Promise<ShaderSymbols | undefined> {
	try {
		const stat = await fs.stat(absolutePath);
		if (!stat.isFile() || stat.size > MAX_INCLUDE_BYTES) {
			return undefined;
		}
		const cached = includeCache.get(absolutePath);
		if (cached && cached.mtimeMs === stat.mtimeMs) {
			return cached.symbols;
		}
		const symbols = extractSymbols(await fs.readFile(absolutePath, 'utf-8'));
		includeCache.set(absolutePath, { mtimeMs: stat.mtimeMs, symbols });
		return symbols;
	} catch {
		return undefined;
	}
}

export async function getResolvedSymbols(document: vscode.TextDocument): Promise<ResolvedSymbols> {
	const key = document.uri.toString();
	const cached = documentCache.get(key);
	if (cached && cached.version === document.version) {
		return cached.result;
	}

	const local = extractSymbols(document.getText());
	const origins = new Map<string, SymbolOrigin>();
	for (const list of [local.functions, local.macros, local.structs]) {
		for (const item of list) {
			origins.set(item.name, { line: item.line });
		}
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
	const visited = new Set<string>([document.uri.fsPath]);
	const included: ShaderSymbols[] = [];
	let hasOpaqueIncludes = false;

	async function visit(symbols: ShaderSymbols, fromFile: string, depth: number): Promise<void> {
		for (const include of symbols.includes) {
			if (visited.size >= MAX_INCLUDE_FILES) {
				hasOpaqueIncludes = true;
				return;
			}
			const resolved = await resolveInclude(include, fromFile, workspaceFolder);
			if (KNOWN_PACKAGE_INCLUDE.test(include) && (!resolved || SKIPPED_PATH_PATTERN.test(resolved))) {
				continue; // URP / SRP Core / Shader Graph library: covered by curated data, not "opaque".
			}
			if (!resolved || SKIPPED_PATH_PATTERN.test(resolved)) {
				hasOpaqueIncludes = true;
				continue;
			}
			if (visited.has(resolved)) {
				continue;
			}
			visited.add(resolved);
			const loaded = await loadIncludeSymbols(resolved);
			if (!loaded) {
				hasOpaqueIncludes = true;
				continue;
			}
			included.push(loaded);
			for (const list of [loaded.functions, loaded.macros, loaded.structs]) {
				for (const item of list) {
					if (!origins.has(item.name)) {
						origins.set(item.name, { file: resolved, line: item.line });
					}
				}
			}
			if (depth < MAX_INCLUDE_DEPTH) {
				await visit(loaded, resolved, depth + 1);
			}
		}
	}
	await visit(local, document.uri.fsPath, 1);

	const result: ResolvedSymbols = { local, all: mergeSymbols(local, included), origins, hasOpaqueIncludes };
	documentCache.set(key, { version: document.version, result });
	return result;
}

export function registerSymbolCacheInvalidation(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument((document) => {
			documentCache.delete(document.uri.toString());
		}),
		// An included file changed on disk or in an editor: cached documents may be stale.
		vscode.workspace.onDidSaveTextDocument((saved) => {
			includeCache.delete(saved.uri.fsPath);
			documentCache.clear();
		}),
	);
}
