# Change Log

All notable changes to ShaderLab Kit will be documented in this file.

## [0.1.3] - Alpha

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
