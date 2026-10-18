// #include resolution for Unity ShaderLab/HLSL files. Ported (TypeScript rewrite, not a copy) from
// shadeview-2.0's Utilities.js (getPath/getProjectRootFolder/getUnityApplicationPath/getPackagesPath/
// getLocalPackages/GetPackageNameInInclude) — see THIRD_PARTY_NOTICES.md. Scope is HLSL/URP only: the
// Unity Editor path is detected only as a fallback for non-package built-in HLSL includes, never to
// special-case the legacy CGIncludes/ folder (out of scope — see shaderlab-domain skill).

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Walks up from `fromFile` looking for a Unity project root: a directory containing both an
 * `Assets` and a `Library` folder. Falls back to a plain path-segment check (`/assets/`,
 * `/packages/`, `/library/packagecache/`) for files already inside one of those trees whose
 * literal ancestor may not itself hold both folders (e.g. a file deep under `Library/PackageCache`).
 */
export async function findProjectRoot(fromFile: string): Promise<string | undefined> {
	const lower = fromFile.toLowerCase();
	for (const marker of [
		`${path.sep}assets${path.sep}`,
		`${path.sep}packages${path.sep}`,
		`${path.sep}library${path.sep}packagecache${path.sep}`,
	]) {
		const index = lower.indexOf(marker);
		if (index !== -1) {
			return fromFile.substring(0, index);
		}
	}

	let dir = path.dirname(fromFile);
	for (;;) {
		const [hasAssets, hasLibrary] = await Promise.all([
			pathExists(path.join(dir, 'Assets')),
			pathExists(path.join(dir, 'Library')),
		]);
		if (hasAssets && hasLibrary) {
			return dir;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}

/** Parses `<HintPath>...Managed[/\\](UnityEngine.)?UnityEngine.dll</HintPath>` out of an Assembly-CSharp.csproj. */
export function parseEditorPathFromCsproj(content: string): string | undefined {
	const match = content.match(/<HintPath>(.+)Managed.(UnityEngine\.)?UnityEngine\.dll<\/HintPath>/m);
	return match?.[1];
}

/** Parses the `Base path: <path>` line Unity writes into its shader compiler cache logs. */
export function parseEditorPathFromShaderCompilerLog(content: string): string | undefined {
	const marker = 'base path:';
	const lines = content.split(/[\r\n]/);
	if (lines[0]?.toLowerCase().trim() === marker) {
		return lines[1]?.trim();
	}
	if (lines[0]?.toLowerCase().startsWith(marker)) {
		return lines[0].substring(lines[0].toLowerCase().indexOf(marker) + marker.length).trim();
	}
	return undefined;
}

async function detectUnityEditorPath(projectRoot: string): Promise<string | undefined> {
	const csprojPath = path.join(projectRoot, 'Assembly-CSharp.csproj');
	if (await pathExists(csprojPath)) {
		const content = await fs.readFile(csprojPath, 'utf-8');
		const editorPath = parseEditorPathFromCsproj(content);
		if (editorPath) {
			return editorPath;
		}
	}

	const libraryDir = path.join(projectRoot, 'Library');
	if (!(await pathExists(libraryDir))) {
		return undefined;
	}
	const entries = await fs.readdir(libraryDir);
	for (const entry of entries) {
		if (!entry.includes('shadercompiler-')) {
			continue;
		}
		const content = await fs.readFile(path.join(libraryDir, entry), 'utf-8');
		const editorPath = parseEditorPathFromShaderCompilerLog(content);
		if (editorPath) {
			return editorPath;
		}
	}
	return undefined;
}

/** Strips a trailing `@1.2.3`-style version suffix from a package folder name for comparison. */
export function stripPackageVersion(folderName: string): string {
	return folderName.replace(/@[0-9a-zA-Z_.-]+$/, '');
}

/**
 * Splits a `Packages/com.unity.xxx/sub/path` include into its package name and the remaining
 * relative path. Returns undefined if `includePath` doesn't start with `Packages/` (case-insensitive).
 */
export function splitPackageInclude(includePath: string): { packageName: string; relativePath: string } | undefined {
	const prefix = 'packages/';
	if (!includePath.toLowerCase().startsWith(prefix)) {
		return undefined;
	}
	const rest = includePath.substring(prefix.length);
	const slashIndex = rest.replace(/\\/g, '/').indexOf('/');
	if (slashIndex === -1) {
		return undefined;
	}
	return { packageName: rest.substring(0, slashIndex), relativePath: rest.substring(slashIndex + 1) };
}

interface LocalPackage {
	packageName: string;
	/** The target path from a `"file:..."` entry in manifest.json, relative to the Packages folder. */
	target: string;
}

/** Reads `Packages/manifest.json` and returns its `file:`-protocol (local) package dependencies. */
async function getLocalPackages(projectRoot: string): Promise<LocalPackage[]> {
	const manifestPath = path.join(projectRoot, 'Packages', 'manifest.json');
	if (!(await pathExists(manifestPath))) {
		return [];
	}
	try {
		const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
		const result: LocalPackage[] = [];
		for (const [packageName, dependency] of Object.entries<string>(manifest.dependencies ?? {})) {
			if (dependency.startsWith('file:')) {
				result.push({ packageName, target: dependency.substring('file:'.length) });
			}
		}
		return result;
	} catch {
		return [];
	}
}

/** Lists the installed package folder names under `Packages/` and `Library/PackageCache/`. */
async function getPackageFolderNames(projectRoot: string): Promise<string[]> {
	const names: string[] = [];
	for (const dir of [path.join(projectRoot, 'Packages'), path.join(projectRoot, 'Library', 'PackageCache')]) {
		if (!(await pathExists(dir))) {
			continue;
		}
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				names.push(entry.name);
			}
		}
	}
	return names;
}

async function resolvePackageInclude(projectRoot: string, includePath: string): Promise<string | undefined> {
	const split = splitPackageInclude(includePath);
	if (!split) {
		return undefined;
	}
	const { packageName, relativePath } = split;

	for (const folderName of await getPackageFolderNames(projectRoot)) {
		if (stripPackageVersion(folderName).toLowerCase() !== packageName.toLowerCase()) {
			continue;
		}
		const inPackages = path.join(projectRoot, 'Packages', folderName, relativePath);
		if (await pathExists(inPackages)) {
			return inPackages;
		}
		const inCache = path.join(projectRoot, 'Library', 'PackageCache', folderName, relativePath);
		if (await pathExists(inCache)) {
			return inCache;
		}
	}

	for (const local of await getLocalPackages(projectRoot)) {
		if (local.packageName.toLowerCase() === packageName.toLowerCase()) {
			const resolved = path.resolve(path.join(projectRoot, 'Packages'), local.target, relativePath);
			if (await pathExists(resolved)) {
				return resolved;
			}
		}
	}

	return undefined;
}

function getConfig() {
	const config = vscode.workspace.getConfiguration('shaderlabKit.include');
	return {
		enable: config.get<boolean>('enable', true),
		customPaths: config.get<string[]>('customPaths', []),
		unityEditorPathOverride: config.get<string>('unityEditorPathOverride', ''),
	};
}

/**
 * Resolves an `#include "includePath"` directive found in `fromFile` to an absolute path on disk.
 * Resolution order: relative to `fromFile` → `shaderlabKit.include.customPaths` → Package Manager
 * (`Packages/`, `Library/PackageCache/`, local `file:` packages) → Unity Editor install path (for
 * non-package built-in HLSL includes only). Returns undefined if nothing exists on disk, or if
 * `shaderlabKit.include.enable` is false.
 */
export async function resolveInclude(includePath: string, fromFile: string, workspaceFolder?: string): Promise<string | undefined> {
	const { enable, customPaths, unityEditorPathOverride } = getConfig();
	if (!enable) {
		return undefined;
	}

	const relative = path.resolve(path.dirname(fromFile), includePath);
	if (await pathExists(relative)) {
		return relative;
	}

	for (const customPath of customPaths) {
		const base = path.isAbsolute(customPath) ? customPath : path.join(workspaceFolder ?? '', customPath);
		const candidate = path.resolve(base, includePath);
		if (await pathExists(candidate)) {
			return candidate;
		}
	}

	const projectRoot = await findProjectRoot(fromFile);
	if (projectRoot) {
		const packageResolved = await resolvePackageInclude(projectRoot, includePath);
		if (packageResolved) {
			return packageResolved;
		}

		const fromProjectRoot = path.resolve(projectRoot, includePath);
		if (await pathExists(fromProjectRoot)) {
			return fromProjectRoot;
		}
	}

	const editorPath = unityEditorPathOverride || (projectRoot && (await detectUnityEditorPath(projectRoot)));
	if (editorPath) {
		const fromEditor = path.resolve(editorPath, includePath);
		if (await pathExists(fromEditor)) {
			return fromEditor;
		}
	}

	return undefined;
}
