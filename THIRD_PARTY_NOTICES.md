# Third-Party Notices

ShaderLab Kit incorporates data and, in later iterations, algorithms/structure from the following MIT-licensed projects. Both are credited here per the MIT license's attribution requirement.

## shadeview-2.0 ("ShadeView")
Copyright (c) 2025 Przemyslaw Orlowski. MIT License.

Ported:
- `src/data/functions.json` (from `extension/out/src/data/functions.json`) — generic Cg/HLSL intrinsic function signatures and documentation. Pipeline-agnostic; used as-is for completion/hover data.
- `src/data/keywords.json` (from `extension/out/src/data/keywords.json`) — HLSL semantics/registers (e.g. `TEXCOORD*`, `BINORMAL*`). Pipeline-agnostic; used as-is for completion data.
- `src/unity/includeResolver.ts` (algorithm reimplemented from `extension/out/src/Utilities.js`'s `getPath`/`getProjectRootFolder`/`getUnityApplicationPath`/`getPackagesPath`/`getLocalPackages`/`GetPackageNameInInclude`) — Unity project root detection, Unity Editor install path detection (`.csproj` HintPath / `shadercompiler-*.log`), and Package Manager (`Packages/`, `Library/PackageCache/`, local `file:` packages) path resolution. Rewritten in idiomatic async TypeScript, not copied; the legacy `CGIncludes/` special-casing from the original was deliberately dropped (out of scope, HLSL/URP-only).

Not ported (out of scope — Cg/legacy-pipeline-specific; see the README's "Scope" section):
- `data/values.json`, Cg-flavored entries in `data/intellisense.json`, `Builtin.js`, and the `ShadeView.js` provider logic.

## vscode-unitylabshader ("Unity Shader")
Copyright (c) 2026 阿十七 & CodeBuddy. MIT License.

Planned, not yet ported in this pass:
- Symbol cache subsystem (`src/cache/*`) structure, to be adapted for `src/cache/`.
- URP built-in dictionary (`src/urp/urpGlobals.ts`), to be adapted for `src/data/` or `src/unity/`.

Entries above will be updated with exact ported file paths once each port lands.
