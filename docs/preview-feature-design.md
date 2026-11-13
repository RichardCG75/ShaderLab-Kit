# 3D Shader Preview for ShaderLab Kit: feasibility and design


## 0. Method and what was (not) tested

- **Repo**: read `package.json`, `esbuild.js`, `src/extension.ts`, `src/analysis/shaderSymbols.ts`, `src/data/shaderlabSyntax.ts`, `src/unity/includeResolver.ts`, `THIRD_PARTY_NOTICES.md`, `src/testFiles/Test1.shader`.
- **ShadeView**: an Explore subagent read the bundle at `/home/richard/dev/extensions/shadeview-2.0/extension/`. Findings are in §1.
- **Web**: 7 searches (DXC/WASM, naga, Unity bridge, Unity batchmode, webview CSP). Results are linked in §10. Several searches returned thin results, flagged **[unverified]** below.
- **Prototype: none was run.** Local check: `dxc`, `glslangValidator`, `spirv-cross`, `naga`, `emcc` are not installed. `node` v22 and `npm` are. A `unity` ELF exists at `~/.local/bin/unity`; I did **not** execute it (unknown provenance, and plan mode is read-only). **Untested**: every compile path against `src/testFiles/Test1.shader`, every WASM size/perf figure, CSP behaviour in a real webview, Unity bridge latency.

## 1. What exists today

### This repo
- No webview code. `src/extension.ts:8-15` registers five providers; a preview would be a sixth registration (`registerPreview(context)`), plus a command in `package.json` `contributes` (none today; only `configuration`, `grammars`, `snippets`).
- `package.json`: `engines.vscode ^1.85.0`, `main ./dist/extension.js`, no runtime `dependencies` (dev-only). Bundling is a single esbuild entry `src/extension.ts` -> `dist/extension.js`, CJS, node platform (`esbuild.js:28-38`). A webview script needs a **second esbuild entry** (browser/iife) or a separate build target.
- `src/analysis/shaderSymbols.ts` already extracts `Properties` (`ShaderProperty`: name, label, type, defaultValue, attributes, drivenKeywords, line; `:10-21`), `#pragma` keyword lines (`:62-66`), macros, functions with entry points, structs, and includes (`:68-79`). The property regex (`:219`) is **single-line only** and keeps `defaultValue` as a raw string. It will need a typed layer on top (§3), not a rewrite. `keywordEnumKeyword` (`:84`) already encodes Unity's KeywordEnum naming.
- `src/data/shaderlabSyntax.ts` holds the attribute list (`PROPERTY_ATTRIBUTES`, `:17-35`), including Toggle, KeywordEnum, Enum, HDR, NoScaleOffset, Normal, MainTexture, PowerSlider, IntRange.
- `src/unity/includeResolver.ts`: `resolveInclude()` (`:216`) resolves relative, custom paths, `Packages/`, `Library/PackageCache/`, local `file:` packages, and the Editor install (`detectUnityEditorPath`, `:75`). It is the key reusable piece for finding `Core.hlsl` etc.
- Project scope is HLSL/URP only (stated in `includeResolver.ts:1-5`).

### ShadeView 2.0 (reference only; MIT, Copyright (c) 2025 Przemyslaw Orlowski, `shadeview-2.0/LICENSE`)
All paths under `shadeview-2.0/extension/`:
- Command `shaderPreview.renderShader` (`package.json`; `out/src/main.js:48-51`). It opens a webview via `createWebviewPanel` (`out/src/ShaderRenderer.js:103-110`) with `enableScripts: true`.
- **three.js loaded from CDN** `three@latest` (`ShaderRenderer.js:144`): not bundled, unpinned, fails offline. No CSP, no `asWebviewUri`, no `postMessage` (extension and webview never talk after the HTML is set).
- "Translation" is regex substitution (`translateUnityToThree`, `ShaderRenderer.js:270-365`: `float4`->`vec4`, `lerp`->`mix`, `tex2D`->`texture`, ...). It keeps only lines starting with `uniform`/`varying` or containing `gl_Position`/`gl_FragColor`.
- **No ShaderLab parsing** (no `Properties`, `SubShader`, `Pass`, `HLSLPROGRAM` handling in the renderer). Bugs: `unityTranslated` is never set true; `uniformsShaderCode` is undeclared; material is created with `uniforms: {}` (`:162`). Net: real Unity shaders mostly fail and fall back to a default gradient. The README itself calls the translation "clumsy" (README line 95).
- No material editor, no live refresh (shader text read once; reopen to refresh), geometry picker (sphere/cube/cylinder/cone/torus), drag-rotate, wheel-zoom.
- No `.wasm`/native binaries in the package. The package ships 81 MB of `node_modules`.
- **Conclusion**: ShadeView gives us nothing reusable for fidelity. Only the general shape (webview + three.js + mesh picker) is relevant, and that is trivial. Per `THIRD_PARTY_NOTICES.md` we port only `functions.json`/`keywords.json`/include logic; **do not copy ShaderRenderer.js**, and no notice update is needed if we write our own.

## 2. Feasibility: options

Key fact for all options: a real URP shader includes `Core.hlsl`, which pulls in hundreds of macros (`TEXTURE2D`, `CBUFFER_START`, `TransformObjectToHClip`, ...) and platform-specific API headers. Evaluating it outside Unity means shimming or reimplementing that library.

### A. HLSL -> GLSL/WGSL in the webview or host (shim + WASM compiler)
Pipeline: parse ShaderLab -> pick pass -> preprocess (resolve includes via `resolveInclude`, apply keywords) -> compile HLSL to SPIR-V (DXC) -> SPIRV-Cross (GLSL ES) or naga (WGSL) -> three.js `ShaderMaterial`/WebGPU.
- **Fidelity**: medium-high for what compiles; light/shadow/GI correctness depends on our shim of URP lighting functions.
- **Effort**: very high (months). Needs a URP shim header set (`Core.hlsl`, `Lighting.hlsl`, `UnityInput.hlsl` equivalents) that is either authored by us or taken from Unity's package. Unity's own headers are **not redistributable** under MIT (check the Unity Companion License before bundling; **unverified here**), so we would read them from the user's project at runtime via `resolveInclude`, which also means supporting their full macro soup and `#if` trees.
- **Dependencies**: DXC to WASM. Search found no official npm package; `cross-shader` (npm) claims to wrap DXC, glslang, naga and SPIRV-Cross and run in WASM browsers **[unverified: whether its browser build includes DXC]**. ShadowDusk built DXC to WASM at about 17 MB (about 6 MB compressed) **[from its docs, not verified by us]**. That is a large VSIX addition. naga's inputs are WGSL/GLSL/SPIR-V; HLSL is output-only **[HLSL input claims on `naga-wasm` unverified]**. So the front end must be DXC or similar.
- **Platform risk**: low for WASM (runs in the Node extension host or webview on Linux/Windows/macOS; no native binary per-platform story). Native dxc/glslang binaries would need a per-platform story and are rejected.
- **What breaks**: macros/includes (only works if we resolve and shim all of them); keywords (we must enumerate variants: 256+ limit in settings `analysis.maxVariantsWarning`); multi-pass (we can choose one pass, e.g. `UniversalForward`, and ignore the rest); `GrabPass`, compute, geometry/tessellation; platform-specific `#if SHADER_API_*`; texture/sampler separation (GLSL ES 3 combined samplers need SPIRV-Cross remapping). Cbuffer `UnityPerMaterial` maps to plain uniforms.
- **Untested**: whether DXC accepts Unity's `Core.hlsl` unmodified (it uses `#pragma`, SM-version tricks, and Unity-specific macros), and the WASM startup/compile times.

### B. Supported subset with graceful fallback
Parse ShaderLab; for a chosen pass, handle only a recognized subset: unlit (sample `_BaseMap` * `_BaseColor`), and simple lit via our **own** hand-written GLSL (Lambert/Blinn-Phong) driven by the shader's properties. If the shader uses something unsupported, show a clear "preview unsupported: <reason>" panel listing the first blocking construct.
Two sub-variants:
- **B1 (approximation, no compilation)**: ignore the user's fragment code entirely; render a stock material parameterised by Properties (`_BaseColor`, `_BaseMap`, `_Smoothness`...). Low fidelity (it previews the *material*, not the *shader*), but robust.
- **B2 (shim-based translation for a restricted HLSL subset)**: a small hand-written HLSL->GLSL transpiler (types, `lerp`, `saturate`, `mul`, `SAMPLE_TEXTURE2D`, `TransformObjectToHClip`, struct IO, `cbuffer`) for shaders that only use a whitelisted set of functions, built on top of `extractSymbols` and `maskDocument`. Fidelity is high *for the shaders that pass the whitelist*, and the whitelist is explicit and testable.
- **Effort**: B1 low (about 2-3 weeks); B2 medium (about 1-2 months, grows with whitelist).
- **Dependencies**: three.js only (MIT; about 1.2 MB unminified core, **size unverified**, use tree-shaken esbuild bundle). No WASM, no native.
- **Platform risk**: none (pure JS + WebGL, all platforms).
- **What breaks**: anything outside the whitelist (custom includes, lighting calls, `multi_compile` combinatorics, multi-pass). Multi-pass: render only the selected pass; state (Blend/ZWrite/Cull/ZTest) mapped to GL state, which is straightforward.

### C. Delegate to a running Unity Editor
An Editor script (shipped in a Unity package/UPM) hosts a local server (HttpListener/TcpListener), renders a preview scene into a RenderTexture, and streams frames (JPEG/PNG via readback, or WebRTC via Unity Render Streaming) to the webview; the webview sends property edits and camera input back. Properties can instead be edited via `Material` API in-editor.
- **Fidelity**: exact (it is Unity).
- **Effort**: high (Editor package in C#, protocol, versioning across Unity versions, install story) but each piece is conventional. Latency/bandwidth from GPU readback is a known concern (forum threads report readback slowness at high resolutions; **our own measurement: none**).
- **Dependencies**: Unity Editor installed *and open* on the same project; a package the user adds to the project. Unity Render Streaming (com.unity.renderstreaming) is a WebRTC option and needs a signaling server; its Editor-mode use for shader preview is **unverified**. No search result confirmed a custom HTTP/WebSocket server inside the Editor; that is plausible via .NET APIs but **unverified by me**.
- **Platform risk**: Unity supports Linux/Windows/macOS Editors; loopback networking OK. Firewalls/ports and Domain Reload (server must survive recompiles) are risks.
- **What breaks**: nothing about shader semantics; breaks for anyone without Unity open (CI, reviewers, Cursor/vscode.dev users), and the target audience of a lightweight extension.

### D. Offline Unity batchmode / custom approximation
Run `Unity -batchmode -nographics -executeMethod ...` per refresh to render a PNG.
- **Fidelity**: exact in principle, **but** Unity's issue tracker has multiple `-nographics` shader problems (shaders dropped from asset bundles, D3D11 assumption in the shader compiler, compute-shader compiler crashes) so `-nographics` is the wrong flag for rendering; rendering needs a GPU context. Cold start is tens of seconds (**unmeasured**), so no interactivity: unusable for camera orbit or slider edits.
- **Effort**: medium. **Dependencies**: Unity install + license + project lock (a project cannot be opened twice, so it fails when the Editor is already open).
- Verdict: only viable as a "bake a still" command, not a live preview. Rejected.

### Comparison

| | Fidelity | Effort | Deps | Platform risk | Macros/URP | Keywords | Multi-pass |
|---|---|---|---|---|---|---|---|
| A: WASM compile | med-high | very high | DXC WASM (~17 MB [unverified]) + SPIRV-Cross/naga + shim | low (WASM) | needs shim + Unity headers at runtime | per-variant recompiles | one pass at a time |
| B1: stock material | low (material, not code) | low | three.js | none | not needed | map to toggles for display only | n/a |
| B2: whitelist transpile | high for subset | medium | three.js | none | whitelist only | simple `#if` evaluation | selected pass |
| C: live Unity | exact | high | Unity open + C# package | medium (network/domain reload) | native | native | native |
| D: batchmode | exact, non-interactive | medium | Unity, exclusive project lock | medium | native | native | native |

## 3. Recommendation

**Phase B (B1 then B2) in the MVP, keeping the compile pipeline behind an interface so A or C can plug in later.** Reasons: no native binaries or 17 MB WASM in the VSIX, works on all three platforms and in remote/web hosts, delivers the inspector-like editing value (the part that is well-defined) immediately, and fails honestly. C is the right *later opt-in* for users who need exactness, because it avoids re-implementing URP. A is the highest risk/cost and its core assumption (DXC accepting Unity's headers) is untested.

Define `interface PreviewBackend { compile(request): Promise<CompiledPreview | Unsupported> }` so backends are swappable.

## 4. Material property editing

### Parsing to typed controls (new `src/analysis/materialProperties.ts`, pure/vscode-free like `shaderSymbols.ts`)
Reuse `extractSymbols(text).properties`; add `toControl(prop): PropertyControl`:

| Unity type | Control | Uniform |
|---|---|---|
| `Float` | number input | `float` |
| `Range(a,b)` | slider (`[PowerSlider(p)]` non-linear, `[IntRange]` snapping) | `float` |
| `Int` | integer input | `int`/`float` |
| `Color` | color picker + alpha; `[HDR]` allows >1 (numeric intensity); `[Gamma]` converts | `vec4` (linear) |
| `Vector` | 4 number fields | `vec4` |
| `2D` / `Cube` / `3D` | texture slot (file picker / built-in defaults `white`, `black`, `gray`, `bump`, `red`); `[NoScaleOffset]` hides tiling/offset; `[Normal]` flags a normal map; `[MainTexture]`/`[MainColor]` flag main slots | sampler + `_ST` `vec4` |
| `[Toggle]`/`[ToggleOff]`/`[ToggleUI]` | checkbox | float 0/1 + keyword (drivenKeywords) |
| `[KeywordEnum(A,B)]` | dropdown | one keyword via `keywordEnumKeyword` |
| `[Enum(...)]` | dropdown (incl. `UnityEngine.Rendering.CullMode`) | float; also drives `Cull [_Cull]`-style state |
| `[Header]`, `[Space]`, `[HideInInspector]` | layout only / hidden |

Known gaps in the existing parser to fix when building this: single-line property regex (`shaderSymbols.ts:219`) misses multi-line declarations; `defaultValue` is a raw string (e.g. `"white" {}`, `(1,1,1,1)`) needing a typed parse; `[Enum(...)]` args need parsing. These changes must not alter existing completion/hover/diagnostics behaviour (add a new module, keep `ShaderProperty` untouched).

### Storage
- **MVP**: extension-owned JSON in `ExtensionContext.workspaceState`, keyed by shader file URI (+ a "Reset to defaults" action). No files written in the user's project.
- **Later**: optional `.mat` import/export. Unity `.mat` is YAML (`Material: m_SavedProperties: m_TexEnvs / m_Floats / m_Colors`); I did **not** verify the exact schema or how GUIDs map textures to assets (**unverified**). Two-way editing is a Phase 3 item with a real risk: writing back into Unity-owned YAML (and `.meta` GUID textures) can corrupt assets. Start read-only (import) and add export-as-new-file before any in-place write.

### Property -> uniform mapping
Host builds `{ name, kind, value }[]` from controls and sends `setProperties`. Webview sets `uniforms[name].value`; textures load from webview URIs. `_ST` gets tiling/offset; `_MainTex_TexelSize` is derived. Keyword changes trigger a **recompile request** (host) instead of a uniform update; plain values never recompile.

## 5. Webview architecture

- **Where**: new `src/providers/previewPanel.ts` (host: lifecycle, messaging, doc listeners), `src/preview/` for backends (`stockMaterialBackend.ts`, later `hlslTranspiler.ts`), `src/analysis/materialProperties.ts`, and `src/webview/main.ts` (browser bundle). Registered from `extension.ts`.
- **Lifecycle**: command `shaderlabKit.preview.open` (editor title button for `shaderlab`/`hlsl`), singleton panel via `createWebviewPanel('shaderlabKitPreview', ..., ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [extension dist/, workspace folders] })`, plus a `WebviewPanelSerializer` to restore. On hide, stop the render loop; on dispose, release listeners. `retainContextWhenHidden` costs memory, so instead re-send state on `visible`.
- **Message protocol** (typed unions shared by both bundles):
  - host -> web: `init {meshes, controls}`, `setProgram {glsl, passName, renderState}` / `setUnsupported {reason, line}`, `setProperties {...}`, `setKeywords`, `setLighting`, `setMesh`.
  - web -> host: `ready`, `propertyChanged {name, value}`, `requestTexture {name}` (opens `showOpenDialog`; host replies with a webview URI), `keywordChanged`, `settings`, `log`/`error {message}`, `compileDiagnostics` (shown in the Problems panel via the existing diagnostics collection, if reused).
- **Live refresh**: `onDidChangeTextDocument` for the active shader, debounced about 400 ms, `onDidSaveTextDocument` immediate; only reparse when text changed; ignore stale compiles with a monotonically increasing request id. Property edits are sent without a recompile.
- **Scene**: mesh picker (sphere, cube, plane, cylinder, torus; later custom `.obj`/`.glb` via GLTFLoader), orbit controls (OrbitControls is in three.js examples, MIT), one directional + ambient light with angle sliders, optional HDRI/skybox, background color, wireframe, time uniform (`_Time`, `_SinTime`) with play/pause, auto-resize.
- **CSP and assets**: strict meta CSP: `default-src 'none'; img-src ${cspSource} blob: data:; style-src ${cspSource}; script-src 'nonce-${nonce}'` plus `'wasm-unsafe-eval'` only if a WASM backend ships. Everything bundled locally; no CDN (the contrast with ShadeView's CDN load at `ShaderRenderer.js:144`). Load scripts and textures through `webview.asWebviewUri`, with `localResourceRoots` limited to `dist/` and the specific folders of chosen textures (so a texture from the Unity project needs its folder added; recreate the panel or use data URLs for small images). The `wasm-unsafe-eval` point is from general CSP docs; **I did not test it in a VS Code webview**.
- **Build**: add a second esbuild entry (`platform: 'browser'`, `format: 'iife'`, `outfile: dist/webview.js`) in `esbuild.js`. three.js becomes the first runtime `dependency` (MIT; bundle size **to be measured**, tree-shake to `WebGLRenderer`, geometries, `ShaderMaterial`, OrbitControls). Cost the extension VSIX (currently ships `dist/`; see `shaderlab-kit-0.1.3.vsix` at the repo root for a baseline) and cap the budget at, say, +1 MB.
- **Engines**: nothing here needs a VS Code newer than 1.85 (webview API is old). Keep `^1.85.0`.

## 6. Phasing

**MVP (Phase 1, B1)**: command + panel; parse `Properties`; typed inspector (Float/Range/Int/Color/Vector/Toggle/Enum/KeywordEnum/2D texture); workspaceState persistence; stock Unlit + simple Lit preview parameterised by recognized properties (`_BaseColor`, `_BaseMap`, `_Smoothness`, `_Metallic`, `_BumpMap`, `_EmissionColor`); mesh picker, orbit, directional light; Blend/Cull/ZWrite mapping; honest "approximate preview" banner.
**Explicitly unsupported in MVP**: executing the user's HLSL; `#include` evaluation; real `multi_compile`/keyword variants (toggles show but don't change code); multi-pass and `UsePass`/`GrabPass`; Cube/3D textures (placeholder), compute/geometry/tessellation; shadows, GI, reflection probes, fog, additional lights; custom mesh import; `.mat` read/write; SRP Batcher; vertex animation; Shader Graph.
**Phase 2 (B2)**: whitelist HLSL->GLSL transpiler for unlit/simple-lit shaders, keyword-aware `#if`, `_Time`, vertex displacement, Cube textures, `.obj` meshes, diagnostics pushed to Problems.
**Phase 3**: `.mat` import then export; optional Unity bridge (C) behind a setting; evaluate WASM DXC (A) only if B2's whitelist proves too restrictive.

## 7. Risks and open questions
1. **Value risk**: B1 previews the *material*, not the user's *code*; users may expect their HLSL to run. Mitigation: banner, and Phase 2.
2. Whether a whitelist transpiler stays maintainable (every new macro is work). Gate Phase 2 on a corpus of real shaders.
3. Unity headers' licence and redistribution (Unity Companion License terms **unverified**); we avoid bundling them.
4. DXC-on-Unity-headers viability and WASM size/startup (**untested**).
5. `.mat` YAML schema and GUID texture resolution (**unverified**); risk of corrupting assets on write.
6. three.js size/budget in the VSIX (**unmeasured**).
7. Linux/WebGL availability in remote/headless hosts (webview needs GPU or software GL; **untested**).
8. Decisions (resolved by the maintainer):
   - (a) An approximate material preview is acceptable as the MVP; executing the user's HLSL is not required from day one.
   - (b) A Unity-open-required bridge is acceptable as a later phase.
   - (c) three.js may be added as the first runtime dependency.

## 8. Verification for the later implementation (not this step)
- Unit tests (pure modules): `materialProperties` on `Test1.shader` and property fixtures with every attribute; protocol type tests.
- Manual: `npm run package`, F5 Extension Host, open `src/testFiles/Test1.shader`, run the preview command; edit `_BaseColor`, `_Intensity`; save the file and confirm refresh; check no CSP errors in the webview devtools.
- Check VSIX size delta and `engines.vscode` unchanged.

## 9. Files touched when implemented (MVP)
New: `docs/preview-feature-design.md`, `src/providers/previewPanel.ts`, `src/analysis/materialProperties.ts`, `src/preview/*`, `src/webview/main.ts`. Modified: `src/extension.ts`, `package.json` (command, menu, `three` dependency), `esbuild.js` (webview entry), `THIRD_PARTY_NOTICES.md` (only if anything from ShadeView is used, currently planned: nothing).

## 10. Sources (web)
- [ShadowDusk WASM frontend (DXC-in-WASM sizes)](https://kaltinril.github.io/ShadowDusk/architecture/wasm-frontend.html)
- [cross-shader readme](https://cdn.jsdelivr.net/npm/cross-shader@0.2.3/readme.md)
- [naga-wasi-cli (inputs wgsl/glsl/spv)](https://www.pkgstats.com/pkg:naga-wasi-cli)
- [shader-converter-wasm](https://app.unpkg.com/shader-converter-wasm@0.1.0/files/README.md)
- [Unity Render Streaming docs](https://docs.unity3d.com/Packages/com.unity.renderstreaming@3.0/manual/components.html)
- [uTextureSendReceive](https://github.com/Joon-Jung/uTextureSendReceive)
- [Unity issue tracker: -nographics shader compiler](https://issuetracker.unity3d.com/issues/a-dx11-shader-error-is-thrown-when-compiling-shaders-for-platforms-without-dx11-support)
- [WebAssembly CSP proposal](https://github.com/WebAssembly/content-security-policy/blob/main/proposals/CSP.md)
