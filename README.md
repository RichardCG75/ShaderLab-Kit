# ShaderLab Kit

> **Alpha software.** Built by hand-merging ideas from two existing Unity shader extensions into something more modern. Expect rough edges, missing features, and breaking changes to settings between versions. Feedback and contributions welcome — see [Where to start](#where-to-start) below.

VS Code tooling for writing Unity shaders in **HLSL on the Universal Render Pipeline (URP)** — completion, hover docs, diagnostics, formatting, go-to-definition, and snippets for `.shader`, `.hlsl`, `.cginc`, and `.compute` files.

ShaderLab Kit is **not** a replacement for VS Code's own syntax highlighting — it builds on top of VS Code's built-in `shaderlab` and `hlsl` languages instead of competing with them (see [How it works](#how-it-works)).

## Scope: HLSL / URP only, no legacy Cg

This extension deliberately does **not** support Unity's legacy Cg pipeline (`CGPROGRAM`/`ENDCG`/`CGINCLUDE`, `UnityCG.cginc`, surface shaders, etc.). It targets `HLSLPROGRAM`/`ENDHLSL`/`HLSLINCLUDE` blocks and URP/SRP HLSL built-ins (`TEXTURE2D`/`SAMPLE_TEXTURE2D`, `TransformObjectToWorld`, `GetMainLight()`, and similar). If your project still uses Cg-style shaders, this isn't (yet) the right tool.

## Features

- **Syntax highlighting** — a TextMate *injection* grammar layered on top of VS Code's built-in ShaderLab/HLSL grammars, adding proper highlighting for Unity/URP macros and functions (`UNITY_MATRIX_*`, `UNITY_SETUP_INSTANCE_ID`, `TEXTURE2D`/`SAMPLE_TEXTURE2D`, `GetMainLight()`, etc.) that the generic grammars don't know about.
- **Completion** — HLSL intrinsics (`lerp`, `mul`, `saturate`, ...), HLSL semantics (`POSITION`, `TEXCOORD0`, `SV_Target`, ...), curated Unity/URP globals and functions (`_Time`, `_MainTex_ST`, `GetMainLight()`, transform helpers, ...), `Blend`/`ZWrite`/`ZTest`/`Cull` enum values inside `Pass {}`, ShaderLab property-type completion inside `Properties {}`, and `#include "..."` path completion.
- **Hover** — documentation for HLSL intrinsics, HLSL semantics (explains what `POSITION`, `SV_Target`, etc. actually mean, not just a label), Unity/URP globals, ShaderLab property types, and the resolved absolute path for `#include` directives.
- **Go-to-definition** — ctrl/cmd-click an `#include "..."` to jump to the resolved file, or a `Fallback "Shader/Name"` to jump to that shader's declaration elsewhere in the workspace.
- **`#include` resolution** — understands Unity project layout: resolves relative includes, Unity Package Manager paths (`Packages/...`, `Library/PackageCache/...`, versioned folders, local `file:` packages), and can fall back to an auto-detected (or manually configured) Unity Editor install path.
- **Diagnostics** — four conservative, low-false-positive checks: unbalanced brackets, legacy-Cg constructs flagged as unsupported, likely-misspelled Unity/URP macro names ("did you mean `GetMainLight`?"), and wrong argument counts for known HLSL intrinsics. Deliberately does **not** attempt missing-semicolon detection — that needs a real parser to avoid being more annoying than helpful.
- **Formatting** — brace/indentation reflow (Allman style), single-line `Tags {}` collapsing, `CBUFFER_START`/`CBUFFER_END` indentation, preprocessor-conditional body indentation (code inside `#if`/`#ifdef`/`#endif` indents naturally), and configurable macro-alignment.
- **Snippets** — a full URP shader template (`shader`), a `Pass` skeleton (`pass`), structs (`struct`, `struct-attributes`, `struct-varyings`), vertex-transform boilerplate (`xform-vertex`), and one snippet per ShaderLab property type (`prop-color`, `prop-range`, `prop-2d`, ...).

## Requirements

- VS Code `^1.140.0`.
- No Unity installation is required for basic features. `#include` resolution and Unity Editor path detection work best inside an actual Unity project folder (one with `Assets/`/`Library/` folders), but degrade gracefully otherwise.

## Setup (for development — this isn't on the Marketplace yet)

```bash
git clone https://github.com/RichardCG75/shaderlab-kit
cd shaderlab-kit
npm install
```

Then in VS Code:

1. Install the **esbuild Problem Matchers** extension (`connor4312.esbuild-problem-matchers`) if you don't already have it — VS Code will prompt you via the recommended-extensions notification, or install it manually. Without it, the build task's problem matcher reference won't resolve and the debug launch will silently fail.
2. Press **F5** (or use the Run and Debug sidebar → "Run Extension"). This builds the extension and opens a new **Extension Development Host** window — that's where the extension actually runs. Open a `.shader`/`.hlsl` file *in that new window*, not your original editing window.
3. Make sure the file's language mode (bottom-right corner) actually says **ShaderLab** or **HLSL** — VS Code sometimes guesses wrong (e.g. associates `.shader` with C++) and the extension won't activate until it's corrected.

Useful scripts:

| Command | What it does |
|---|---|
| `npm run watch` | Rebuilds on save (what F5 uses under the hood) |
| `npm run check-types` | TypeScript type-check only, no emit |
| `npm run lint` | ESLint over `src/` |
| `npm run package` | Production build (type-check + lint + minified bundle) |

## Configuration

All settings are namespaced under `shaderlabKit.*` (Settings UI → search "ShaderLab Kit"):

| Setting | Default | Description |
|---|---|---|
| `shaderlabKit.suggest.enable` | `true` | Master toggle for completion and hover. |
| `shaderlabKit.analysis.enable` | `true` | Master toggle for diagnostics. |
| `shaderlabKit.analysis.maxVariantsWarning` | `256` | Reserved for future shader-variant-count analysis. |
| `shaderlabKit.analysis.maxVariantsError` | `512` | Reserved for future shader-variant-count analysis. |
| `shaderlabKit.formatting.enable` | `true` | Master toggle for the formatter. |
| `shaderlabKit.formatting.bracestyle` | `true` | Reflow braces to Allman style (opening brace on its own line). |
| `shaderlabKit.formatting.tags.singleline` | `true` | Collapse `Tags { ... }` blocks to one line. |
| `shaderlabKit.formatting.cbuffer` | `true` | Indent the contents of `CBUFFER_START(...)`/`CBUFFER_END` blocks. |
| `shaderlabKit.formatting.alignMacros` | `"Hierarchy Indentation"` | How `#directive` lines themselves are indented: `None`, `Align Left`, `Hierarchy Indentation`, or `Align With Code` (the latter two currently behave identically — see [How it works](#how-it-works)). |
| `shaderlabKit.formatting.indentWithinPreprocessor` | `true` | Indent code *between* `#if`/`#ifdef`/`#endif` one level deeper, independent of `alignMacros`. |
| `shaderlabKit.include.enable` | `true` | Master toggle for `#include` resolution (powers hover/go-to-definition on includes). |
| `shaderlabKit.include.customPaths` | `[]` | Extra search paths (absolute or workspace-relative) checked when resolving `#include`. |
| `shaderlabKit.include.unityEditorPathOverride` | `""` | Explicit Unity Editor install path, for when auto-detection fails (CI, no local Unity install, etc.). |

## How it works

- **No language server.** Everything runs in-process as ordinary VS Code providers (`CompletionItemProvider`, `HoverProvider`, etc.) — see `src/providers/`. No LSP process, no IPC overhead; there's no symbol-cache-scale problem yet that would justify one.
- **VS Code already ships `.shader`/`.hlsl` support** (built-in `shaderlab` and `hlsl` extensions — grammar only, no IntelliSense). ShaderLab Kit hooks into those existing language IDs rather than declaring its own, and layers an **injection grammar** (`syntaxes/shaderlab-kit.injection.tmLanguage.json`) on top for the Unity/URP-specific tokens the generic grammars miss. This means ShaderLab Kit stays compatible with any other extension or theme that also targets `source.shaderlab`/`source.hlsl`.
- **Line-based, not AST-based.** The formatter and diagnostics are regex/line-scanning tools (masking comments and strings first — see `src/utils/commentMask.ts`), not a real parser. This keeps the implementation simple and fast, at the cost of some checks being intentionally conservative (see the diagnostics list above) rather than exhaustive.
- **`#include` resolution** (`src/unity/includeResolver.ts`) understands Unity's project layout and Package Manager conventions — reimplemented from scratch in TypeScript, based on the approach in `shadeview-2.0` (see [Credits](#credits--license)).

## Where to start

- **`src/providers/`** — one file per VS Code provider (`completionProvider.ts`, `hoverProvider.ts`, `definitionProvider.ts`, `formattingProvider.ts`, `diagnosticsProvider.ts`). Each is reasonably self-contained; this is the natural place to start if you want to add or fix a feature.
- **`src/data/`** — the completion/hover data: ported HLSL intrinsic/semantic dictionaries (`functions.json`, `keywords.json`), curated Unity/URP globals (`urpBuiltins.ts`), and semantic documentation (`hlslSemantics.ts`). Often the easiest place to contribute — adding a missing built-in is usually a one-line data change plus a doc string.
- **`snippets/shaderlab-kit.json`** — add a snippet here if you find yourself typing the same boilerplate repeatedly.
- Good first issues: anything in [Known limitations](#known-limitations-alpha) below, or a Unity/URP built-in that's missing from `src/data/urpBuiltins.ts`.

## Contributing

Contributions are welcome — this is open source and intended to grow with outside input.

1. Fork the repo and create a branch for your change.
2. Before opening a PR, make sure it passes:
   ```bash
   npm run check-types
   npm run lint
   ```
3. Open a pull request describing what changed and why. Small, focused PRs are easier to review than large ones.
4. For anything beyond a small fix — a new feature, a change to scope (e.g. "should this support legacy Cg after all?"), or an architecture change — please open an [Issue](../../issues) or [Discussion](../../discussions) first, so we can agree on direction before you put in the work.

Found a bug, have a feature idea, or just want to ask a question?

- **GitHub Issues** — bug reports, concrete feature requests.
- **GitHub Discussions** — open-ended questions, ideas, "should this project do X?"
- **Email** — rchacon.dev@proton.me, for anything that doesn't fit the above.

## Known limitations (alpha)

- No semantic analysis, shader-variant-combination analysis, or mobile-platform analysis yet (settings exist as placeholders: `analysis.maxVariantsWarning`/`maxVariantsError`).
- No symbol cache — go-to-definition for `Fallback` does a per-call workspace text scan rather than an indexed lookup; fine for typical projects, may be slow on very large ones.
- Range-formatting (formatting a selection) currently reformats the whole document rather than just the selection, since brace-style reflow can change line counts.
- No legacy Cg pipeline support, by design (see [Scope](#scope-hlsl--urp-only-no-legacy-cg) above) — this isn't a bug to report, it's an intentional boundary.
- Not published to the VS Code Marketplace yet — see [Setup](#setup-for-development--this-isnt-on-the-marketplace-yet) to run it locally.

## Credits & License

MIT — see [`LICENSE`](./LICENSE). Contributions, forks, and modifications are welcome.

This project was built by comparing and merging ideas from two existing, independently-developed, MIT-licensed Unity shader extensions. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for exactly what was ported from each and the required attribution:

- **shadeview-2.0** ("ShadeView") by Przemyslaw Orlowski — source of the HLSL intrinsic/semantic data and the `#include` resolution approach.
- **vscode-unitylabshader** ("Unity Shader") — source of architectural inspiration (modular provider structure, well-namespaced settings).
