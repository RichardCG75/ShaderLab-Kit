# Change Log

All notable changes to ShaderLab Kit will be documented in this file.

## [Unreleased]

### Added

- Shader-aware symbols: properties, keywords (including `[Toggle]` and `[KeywordEnum]`-generated ones), `#define` macros, functions (with leading doc comments), structs and struct members are now completed, hovered and go-to-definition-able, across the open file and its project-local `#include`s. Package-cache and Unity Editor includes are not scanned.
- Struct member completion and hover for `var.` when `var` is declared with a user struct or a URP struct (`Light`, `VertexPositionInputs`, `VertexNormalInputs`, `InputData`, `SurfaceData`).
- ShaderLab syntax completion and hover: material property attributes, `Tags` keys/values, SubShader/Pass statements, `Stencil` blocks, and values for `ColorMask`, `BlendOp` and `AlphaToMask`.
- `#pragma` completion and hover: directive names with usage guidance, entry-point names, keyword lists, `target` and renderer lists.
- Keyword-aware completion inside `#if` / `#ifdef` / `defined(...)`.
- 130 new URP/SRP Core entries (space transforms, fog, SH/GI, shadow bias, light loop, SRP Batcher and instancing macros, platform macros, texture macros, math/color helpers, URP shader keywords) with the defining include shown in hover.
- Diagnostics: a property-driven keyword that no `#pragma` declares; material-driven keywords declared without `_local`; typo detection for undefined keywords in `#if`/`defined()`.
- Snippets: ShadowCaster and DepthOnly passes, `HLSLINCLUDE` + `UnityPerMaterial`, `[Toggle]`/`[KeywordEnum]`/`[HDR]`/Cull-enum properties, keyword pragmas, include guard, instancing setup, Lambert + SH lighting.
- Syntax highlighting for the new URP functions/macros and for `FallBack`, `CustomEditor`, `Stencil`, `ColorMask`, `BlendOp`, `AlphaToMask`.

### Changed

- Completion is context-aware: ShaderLab statements only appear in ShaderLab scope (not inside HLSL), and inside `Properties { }` only property snippets, types and attributes are offered instead of the whole HLSL list.
- Functions and structs defined in the file are no longer reported as "did you mean" misspelled URP built-ins.

### Fixed

- Go-to-definition on `FallBack "..."` (Unity's usual spelling) did not work; only `Fallback` was recognised.

## [0.2.1]

### Changed

- Lowered the minimum supported VS Code version from 1.140.0 to 1.85.0.

## [0.2.0]

### Fixed

- Formatter: directives inside a function (`#if`/`#elif`/`#endif`) no longer sit a level to the left of their own body, which made code inside `#if` blocks look double-indented. Applies to `.shader` and `.hlsl` alike.
- Formatter: header include guards (`#ifndef X` + `#define X`) no longer indent the whole file.

### Added

- `shaderlabKit.formatting.preprocessorStyle` (`Hierarchy`, `Follow Code`, `Flush Left`, `None`) and `shaderlabKit.formatting.indentIncludeGuard`.

### Deprecated

- `shaderlabKit.formatting.alignMacros` and `shaderlabKit.formatting.indentWithinPreprocessor`: still honored when `preprocessorStyle` isn't set, but superseded by it.

## [0.1.0] - Alpha

First alpha release. HLSL/URP only — no legacy Cg pipeline support (see README).

### Added

- Syntax highlighting: injection grammar layered on VS Code's built-in `shaderlab`/`hlsl` grammars, adding Unity/URP-specific tokens.
- Completion: HLSL intrinsics and semantics, curated Unity/URP globals and functions, `Blend`/`ZWrite`/`ZTest`/`Cull` enum values, ShaderLab property-type completion, `#include` path completion. Function completions insert full call snippets with tabstop-able argument placeholders.
- Hover: HLSL intrinsic docs, HLSL semantic documentation, Unity/URP global docs, ShaderLab property-type docs, resolved `#include` paths.
- Go-to-definition for `#include "..."` and `Fallback "Shader/Name"`.
- `#include` resolution: relative paths, Unity Package Manager paths (including versioned folders and local `file:` packages), and Unity Editor install path auto-detection with manual override.
- Diagnostics: unbalanced brackets, legacy-Cg constructs flagged as unsupported, misspelled Unity/URP macro name detection, wrong HLSL intrinsic argument counts.
- Formatting: brace/indentation reflow, `Tags {}` single-line collapsing, `CBUFFER_START`/`CBUFFER_END` indentation, preprocessor-conditional body indentation, configurable macro alignment.
- Snippets: full URP shader template, `Pass` skeleton, structs, vertex-transform boilerplate, ShaderLab property declarations.

### Known limitations

See the README's "Known limitations (alpha)" section.
