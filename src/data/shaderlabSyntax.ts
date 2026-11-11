// Curated ShaderLab (non-HLSL) syntax knowledge for ShaderLab Kit: Properties attributes, pass/subshader
// statements and their values, `Tags` keys/values, and `#pragma` directives. Written for URP-era Unity
// (HLSLPROGRAM); legacy Cg/surface-shader pragmas are deliberately left out.

export interface DocEntry {
	name: string;
	/** Markdown documentation shown in hover and completion details. */
	doc: string;
}

export interface SnippetEntry extends DocEntry {
	/** VS Code snippet body inserted on completion (defaults to `name` when omitted). */
	snippet?: string;
}

/** Material property attributes written as `[Attr]` / `[Attr(args)]` before a property declaration. */
export const PROPERTY_ATTRIBUTES: SnippetEntry[] = [
	{ name: 'Toggle', snippet: 'Toggle(${1:_KEYWORD})', doc: '`[Toggle]` / `[Toggle(_KEYWORD)]` — shows a checkbox for a Float property (0/1). With an argument it enables that shader keyword while checked; without one it enables `_PROPERTYNAME_ON`. The keyword must also be declared with `#pragma shader_feature_local` (or `multi_compile_local`) in every pass that uses it.' },
	{ name: 'ToggleOff', snippet: 'ToggleOff(${1:_KEYWORD})', doc: '`[ToggleOff]` — like `[Toggle]`, but the keyword is enabled while the checkbox is **unchecked** (`_PROPERTYNAME_OFF` by default).' },
	{ name: 'ToggleUI', doc: '`[ToggleUI]` — checkbox for a Float property that sets 0/1 but does **not** touch any shader keyword.' },
	{ name: 'KeywordEnum', snippet: 'KeywordEnum(${1:None}, ${2:Option A}, ${3:Option B})', doc: '`[KeywordEnum(A, B, C)]` — dropdown that enables exactly one keyword named `_PROPERTYNAME_A`, `_PROPERTYNAME_B`, … (upper-cased, spaces become `_`). Declare all of them in one `#pragma shader_feature_local` / `multi_compile_local` line. Max 9 entries.' },
	{ name: 'Enum', snippet: 'Enum(${1:Off}, ${2:0}, ${3:On}, ${4:1})', doc: '`[Enum(Label, value, …)]` or `[Enum(UnityEngine.Rendering.CullMode)]` — dropdown that writes a numeric value into a Float property. Typically feeds a state like `Cull [_Cull]`. Does **not** set keywords.' },
	{ name: 'Header', snippet: 'Header(${1:Section Name})', doc: '`[Header(Text)]` — draws a bold section header above the property in the material Inspector.' },
	{ name: 'Space', snippet: 'Space(${1:10})', doc: '`[Space]` / `[Space(pixels)]` — adds vertical space above the property in the Inspector.' },
	{ name: 'HDR', doc: '`[HDR]` — on a Color property, allows intensity values above 1 (HDR color picker). Use for emission colors.' },
	{ name: 'Gamma', doc: '`[Gamma]` — on a Color or Vector property, the value is entered in gamma space and converted to linear when the project uses Linear color space.' },
	{ name: 'NoScaleOffset', doc: '`[NoScaleOffset]` — hides the Tiling/Offset fields for a texture property (so `_ST` is not needed).' },
	{ name: 'Normal', doc: '`[Normal]` — warns in the Inspector if the assigned texture is not imported as a Normal Map.' },
	{ name: 'PowerSlider', snippet: 'PowerSlider(${1:3.0})', doc: '`[PowerSlider(power)]` — on a Range property, uses a non-linear slider (value = t^power).' },
	{ name: 'IntRange', doc: '`[IntRange]` — on a Range property, makes the slider snap to integers.' },
	{ name: 'MainTexture', doc: '`[MainTexture]` — marks this texture as the material main texture (`Material.mainTexture`), instead of relying on the `_MainTex` name.' },
	{ name: 'MainColor', doc: '`[MainColor]` — marks this color as the material main color (`Material.color`), instead of relying on the `_Color` name.' },
	{ name: 'HideInInspector', doc: '`[HideInInspector]` — hides the property in the default material Inspector (still settable from scripts).' },
	{ name: 'PerRendererData', doc: '`[PerRendererData]` — value is supplied per renderer via `MaterialPropertyBlock` (e.g. SpriteRenderer); hidden from the material Inspector.' },
];

/** ShaderLab statements allowed in SubShader / Pass (and `Shader`) scope. */
export interface StatementEntry extends SnippetEntry {
	scopes: ('Shader' | 'SubShader' | 'Pass')[];
}

export const SHADERLAB_STATEMENTS: StatementEntry[] = [
	{ name: 'Name', snippet: 'Name "${1:ForwardLit}"', scopes: ['Pass'], doc: '`Name "PassName"` — names the pass so other shaders can reuse it with `UsePass "Shader/PASSNAME"` (names are upper-cased there) and so it shows in the Frame Debugger.' },
	{ name: 'Tags', snippet: 'Tags { "${1:LightMode}" = "${2:UniversalForward}" }', scopes: ['SubShader', 'Pass'], doc: '`Tags { "Key" = "Value" }` — metadata read by the renderer. In a **SubShader**: `RenderType`, `Queue`, `RenderPipeline`. In a **Pass**: `LightMode`.' },
	{ name: 'LOD', snippet: 'LOD ${1:100}', scopes: ['SubShader'], doc: '`LOD n` — level of detail for this SubShader; used with `Shader.maximumLOD` to drop expensive SubShaders.' },
	{ name: 'Cull', snippet: 'Cull ${1|Back,Front,Off|}', scopes: ['SubShader', 'Pass'], doc: '`Cull Back | Front | Off` — which triangle faces are skipped. Default `Back`. Use `Off` for double-sided foliage; expose with `Cull [_Cull]`.' },
	{ name: 'ZWrite', snippet: 'ZWrite ${1|On,Off|}', scopes: ['SubShader', 'Pass'], doc: '`ZWrite On | Off` — whether the pass writes depth. `Off` for transparent passes.' },
	{ name: 'ZTest', snippet: 'ZTest ${1|LEqual,Less,Greater,GEqual,Equal,NotEqual,Always|}', scopes: ['SubShader', 'Pass'], doc: '`ZTest` — depth comparison. Default `LEqual`. Shadow and depth passes should keep `LEqual`.' },
	{ name: 'ColorMask', snippet: 'ColorMask ${1|RGBA,RGB,R,G,B,A,0|}', scopes: ['SubShader', 'Pass'], doc: '`ColorMask RGB | RGBA | R | G | B | A | 0` — which color channels are written. `0` writes nothing (ShadowCaster); `R` suits a single-channel DepthOnly target. An optional render-target index may follow: `ColorMask RGB 1`.' },
	{ name: 'Blend', snippet: 'Blend ${1:SrcAlpha} ${2:OneMinusSrcAlpha}', scopes: ['SubShader', 'Pass'], doc: '`Blend SrcFactor DstFactor` (optionally `, SrcAlphaFactor DstAlphaFactor`) or `Blend Off`. Alpha blend: `Blend SrcAlpha OneMinusSrcAlpha`; additive: `Blend One One`; premultiplied: `Blend One OneMinusSrcAlpha`.' },
	{ name: 'BlendOp', snippet: 'BlendOp ${1|Add,Sub,RevSub,Min,Max|}', scopes: ['SubShader', 'Pass'], doc: '`BlendOp Add | Sub | RevSub | Min | Max` — the blend equation operator. Default `Add`.' },
	{ name: 'AlphaToMask', snippet: 'AlphaToMask ${1|On,Off|}', scopes: ['SubShader', 'Pass'], doc: '`AlphaToMask On | Off` — converts fragment alpha to an MSAA coverage mask; smoother alpha-tested edges when MSAA is enabled.' },
	{ name: 'Offset', snippet: 'Offset ${1:-1}, ${2:-1}', scopes: ['SubShader', 'Pass'], doc: '`Offset factor, units` — depth bias to avoid z-fighting (decals use negative values). Not needed for shadows; URP applies `ApplyShadowBias` instead.' },
	{ name: 'Stencil', snippet: 'Stencil\n{\n\tRef ${1:1}\n\tComp ${2:Always}\n\tPass ${3:Replace}\n}', scopes: ['SubShader', 'Pass'], doc: '`Stencil { Ref n  ReadMask n  WriteMask n  Comp <fn>  Pass/Fail/ZFail <op> }` — stencil buffer test/write. Also `CompBack`, `PassFront`, … per face.' },
	{ name: 'HLSLPROGRAM', snippet: 'HLSLPROGRAM\n\t#pragma vertex ${1:vert}\n\t#pragma fragment ${2:frag}\n\t$0\nENDHLSL', scopes: ['Pass'], doc: '`HLSLPROGRAM … ENDHLSL` — the HLSL source of a pass. Use this (not `CGPROGRAM`) for URP.' },
	{ name: 'HLSLINCLUDE', snippet: 'HLSLINCLUDE\n\t$0\nENDHLSL', scopes: ['SubShader', 'Shader'], doc: '`HLSLINCLUDE … ENDHLSL` — HLSL code prepended to **every** pass in the SubShader. The right place for the shared `UnityPerMaterial` CBUFFER (SRP Batcher requires an identical layout in all passes) and helpers like vertex animation shared by ForwardLit / ShadowCaster / DepthOnly.' },
	{ name: 'UsePass', snippet: 'UsePass "${1:Universal Render Pipeline/Lit/ShadowCaster}"', scopes: ['SubShader'], doc: '`UsePass "Shader/PASSNAME"` — reuse a named pass from another shader (pass name upper-cased). The reused pass reads **this** material\'s properties, so the CBUFFER layout must be compatible.' },
	{ name: 'CustomEditor', snippet: 'CustomEditor "${1:MyShaderGUI}"', scopes: ['Shader'], doc: '`CustomEditor "ClassName"` — a `ShaderGUI` subclass (in an `Editor` folder) that draws the material Inspector for this shader.' },
	{ name: 'FallBack', snippet: 'FallBack "${1:Universal Render Pipeline/Lit}"', scopes: ['Shader'], doc: '`FallBack "Shader/Name"` (or `FallBack Off`) — shader used if no SubShader is supported. Also supplies passes (e.g. ShadowCaster) the shader does not define when the fallback has them.' },
	{ name: 'Fallback', snippet: 'Fallback "${1:Universal Render Pipeline/Lit}"', scopes: ['Shader'], doc: '`Fallback "Shader/Name"` — same as `FallBack`.' },
	{ name: 'Dependency', snippet: 'Dependency "${1:BaseMapShader}" = "${2:Hidden/Shader}"', scopes: ['Shader'], doc: '`Dependency "Slot" = "Shader/Name"` — declares a companion shader (e.g. Terrain base-map shader).' },
];

/** Value lists for single-keyword ShaderLab statements (used for completion after the keyword). */
export const STATE_VALUES: Record<string, string[]> = {
	Blend: ['One', 'Zero', 'SrcAlpha', 'OneMinusSrcAlpha', 'DstAlpha', 'OneMinusDstAlpha', 'SrcColor', 'OneMinusSrcColor', 'DstColor', 'OneMinusDstColor', 'SrcAlphaSaturate', 'Off'],
	BlendOp: ['Add', 'Sub', 'RevSub', 'Min', 'Max'],
	ZWrite: ['On', 'Off'],
	ZTest: ['Less', 'Greater', 'LEqual', 'GEqual', 'Equal', 'NotEqual', 'Always'],
	Cull: ['Back', 'Front', 'Off'],
	ColorMask: ['RGBA', 'RGB', 'R', 'G', 'B', 'A', '0'],
	AlphaToMask: ['On', 'Off'],
};

/** Values for statements inside a `Stencil { }` block. */
export const STENCIL_COMPARISONS = ['Greater', 'GEqual', 'Less', 'LEqual', 'Equal', 'NotEqual', 'Always', 'Never'];
export const STENCIL_OPERATIONS = ['Keep', 'Zero', 'Replace', 'IncrSat', 'DecrSat', 'Invert', 'IncrWrap', 'DecrWrap'];
export const STENCIL_STATEMENTS: Record<string, string[]> = {
	Comp: STENCIL_COMPARISONS, CompFront: STENCIL_COMPARISONS, CompBack: STENCIL_COMPARISONS,
	Pass: STENCIL_OPERATIONS, PassFront: STENCIL_OPERATIONS, PassBack: STENCIL_OPERATIONS,
	Fail: STENCIL_OPERATIONS, FailFront: STENCIL_OPERATIONS, FailBack: STENCIL_OPERATIONS,
	ZFail: STENCIL_OPERATIONS, ZFailFront: STENCIL_OPERATIONS, ZFailBack: STENCIL_OPERATIONS,
};

/** Keys and values allowed in `Tags { "Key" = "Value" }`. */
export const TAG_KEYS: DocEntry[] = [
	{ name: 'RenderPipeline', doc: 'SubShader tag. `"UniversalPipeline"` makes the SubShader usable only by URP, so Built-in/HDRP skip it instead of rendering it wrongly.' },
	{ name: 'RenderType', doc: 'SubShader tag. Classifies the shader for replacement/override features (e.g. SSAO/depth normals in some pipelines): `Opaque`, `Transparent`, `TransparentCutout`, …' },
	{ name: 'Queue', doc: 'SubShader tag. Render order bucket: `Background` (1000), `Geometry` (2000), `AlphaTest` (2450), `Transparent` (3000), `Overlay` (4000). Offsets allowed: `"Geometry+1"`.' },
	{ name: 'LightMode', doc: 'Pass tag. Tells the pipeline when to run this pass. URP: `UniversalForward`, `ShadowCaster`, `DepthOnly`, `DepthNormals`, `Meta`, `UniversalGBuffer`, `SRPDefaultUnlit`, …' },
	{ name: 'IgnoreProjector', doc: 'Built-in pipeline projector flag. No effect in URP.' },
	{ name: 'DisableBatching', doc: 'SubShader tag: `True`, `False` or `LODFading`. Disables dynamic batching, required when the vertex shader depends on object-space position.' },
	{ name: 'ForceNoShadowCasting', doc: 'SubShader tag: `True` stops objects using this SubShader from casting shadows.' },
	{ name: 'CanUseSpriteAtlas', doc: 'SubShader tag: `False` if the shader breaks when sprites are packed into an atlas.' },
	{ name: 'PreviewType', doc: 'SubShader tag: `Plane` or `Skybox` — shape used for the material preview.' },
];

export const TAG_VALUES: Record<string, DocEntry[]> = {
	RenderPipeline: [
		{ name: 'UniversalPipeline', doc: 'Use only in the Universal Render Pipeline.' },
		{ name: 'HighDefinitionRenderPipeline', doc: 'Use only in HDRP.' },
	],
	RenderType: [
		{ name: 'Opaque', doc: 'Normal solid geometry.' },
		{ name: 'Transparent', doc: 'Alpha-blended geometry.' },
		{ name: 'TransparentCutout', doc: 'Alpha-tested (`clip`/`discard`) geometry.' },
		{ name: 'Background', doc: 'Skybox-like geometry.' },
		{ name: 'Overlay', doc: 'GUI/halo/flare style overlays.' },
	],
	Queue: [
		{ name: 'Background', doc: 'Queue 1000 — rendered first (skyboxes).' },
		{ name: 'Geometry', doc: 'Queue 2000 — default for opaque objects.' },
		{ name: 'AlphaTest', doc: 'Queue 2450 — alpha-tested objects, after opaque.' },
		{ name: 'Transparent', doc: 'Queue 3000 — alpha-blended objects, sorted back-to-front.' },
		{ name: 'Overlay', doc: 'Queue 4000 — rendered last (lens flares, overlays).' },
	],
	LightMode: [
		{ name: 'UniversalForward', doc: 'URP main forward pass (lit and unlit). Runs once per object in the Forward path; additional lights are looped inside the shader.' },
		{ name: 'UniversalForwardOnly', doc: 'Forward pass that is used even when the camera renders with Deferred (for shaders with no GBuffer pass).' },
		{ name: 'UniversalGBuffer', doc: 'URP deferred pass that writes the GBuffer.' },
		{ name: 'ShadowCaster', doc: 'Renders the object into shadow maps. Needs `_LightDirection`/`_LightPosition` and `ApplyShadowBias`; `ColorMask 0` is typical.' },
		{ name: 'DepthOnly', doc: 'Writes the camera depth texture / depth prepass. Must apply the same vertex animation as the forward pass.' },
		{ name: 'DepthNormals', doc: 'Writes depth + normals for SSAO, decals and other effects.' },
		{ name: 'Meta', doc: 'Used only when baking lightmaps/GI to read albedo and emission.' },
		{ name: 'SRPDefaultUnlit', doc: 'Default pass for shaders with no LightMode; renders with the SRP\'s "unlit" shader tag ID. Only one per shader is drawn.' },
		{ name: 'Universal2D', doc: 'URP 2D Renderer lit pass.' },
		{ name: 'MotionVectors', doc: 'Writes per-object motion vectors (motion blur, TAA).' },
	],
	DisableBatching: [
		{ name: 'True', doc: 'Never dynamically batch.' },
		{ name: 'False', doc: 'Allow dynamic batching (default).' },
		{ name: 'LODFading', doc: 'Disable batching only while LOD fading is active.' },
	],
	ForceNoShadowCasting: [{ name: 'True', doc: 'Never cast shadows.' }, { name: 'False', doc: 'Cast shadows normally.' }],
};

/** `#pragma` directives valid in HLSLPROGRAM. */
export const PRAGMAS: SnippetEntry[] = [
	{ name: 'vertex', snippet: 'vertex ${1:vert}', doc: '`#pragma vertex fn` — names the vertex shader entry point.' },
	{ name: 'fragment', snippet: 'fragment ${1:frag}', doc: '`#pragma fragment fn` — names the fragment (pixel) shader entry point.' },
	{ name: 'geometry', snippet: 'geometry ${1:geom}', doc: '`#pragma geometry fn` — geometry shader entry point (needs `#pragma target 4.0`+).' },
	{ name: 'hull', snippet: 'hull ${1:hull}', doc: '`#pragma hull fn` — tessellation hull shader (needs `#pragma target 4.6`).' },
	{ name: 'domain', snippet: 'domain ${1:domain}', doc: '`#pragma domain fn` — tessellation domain shader (needs `#pragma target 4.6`).' },
	{ name: 'target', snippet: 'target ${1|2.0,3.0,3.5,4.0,4.5,4.6,5.0|}', doc: '`#pragma target N` — minimum shader model. Higher targets exclude older GPUs/APIs (GLES2 / WebGL1 need 2.0). Prefer `#pragma require <feature>` for specific features.' },
	{ name: 'require', snippet: 'require ${1|geometry,tessellation,compute,instancing,interpolators10,mrt4,derivatives,samplelod,fragCoord,integers,2darray,cubearray,msaatex,framebufferfetch|}', doc: '`#pragma require feature …` — demands specific GPU features instead of a whole shader model.' },
	{ name: 'multi_compile', snippet: 'multi_compile ${1:_} ${2:_KEYWORD}', doc: '`#pragma multi_compile A B C` — compiles **all** variants into the build and uses the **global** keyword space. Use for pipeline/global states (shadows, fog, lightmaps). For material features prefer `shader_feature_local`.' },
	{ name: 'multi_compile_local', snippet: 'multi_compile_local ${1:_} ${2:_KEYWORD}', doc: '`#pragma multi_compile_local A B` — all variants always built; **local** keywords (don\'t consume the 256 global slots). Use for keywords set from script at runtime on materials unknown at build time.' },
	{ name: 'multi_compile_fragment', snippet: 'multi_compile_fragment ${1:_} ${2:_KEYWORD}', doc: '`#pragma multi_compile_fragment …` — global keyword that only affects the fragment stage, halving the variants (the vertex stage is compiled once). URP uses this for `_SHADOWS_SOFT`.' },
	{ name: 'multi_compile_vertex', snippet: 'multi_compile_vertex ${1:_} ${2:_KEYWORD}', doc: '`#pragma multi_compile_vertex …` — global keyword that only affects the vertex stage (e.g. `_CASTING_PUNCTUAL_LIGHT_SHADOW` in ShadowCaster).' },
	{ name: 'multi_compile_local_fragment', snippet: 'multi_compile_local_fragment ${1:_} ${2:_KEYWORD}', doc: '`#pragma multi_compile_local_fragment …` — local keyword, fragment stage only.' },
	{ name: 'multi_compile_local_vertex', snippet: 'multi_compile_local_vertex ${1:_} ${2:_KEYWORD}', doc: '`#pragma multi_compile_local_vertex …` — local keyword, vertex stage only.' },
	{ name: 'shader_feature', snippet: 'shader_feature ${1:_} ${2:_KEYWORD}', doc: '`#pragma shader_feature A B` — variants are built **only if a material in the build uses them** (unused ones are stripped). Global keyword space; prefer `shader_feature_local`. Toggling the keyword at runtime on a stripped variant falls back to the wrong variant in builds.' },
	{ name: 'shader_feature_local', snippet: 'shader_feature_local ${1:_} ${2:_KEYWORD}', doc: '`#pragma shader_feature_local A B` — **the default choice for per-material toggles**: local keyword, stripped when unused. Pair with `[Toggle(_KEYWORD)]` or `[KeywordEnum]` in Properties. If code flips it at runtime, use `multi_compile_local` instead.' },
	{ name: 'shader_feature_fragment', snippet: 'shader_feature_fragment ${1:_} ${2:_KEYWORD}', doc: '`#pragma shader_feature_fragment …` — global, stripped when unused, fragment stage only.' },
	{ name: 'shader_feature_vertex', snippet: 'shader_feature_vertex ${1:_} ${2:_KEYWORD}', doc: '`#pragma shader_feature_vertex …` — global, stripped when unused, vertex stage only.' },
	{ name: 'shader_feature_local_fragment', snippet: 'shader_feature_local_fragment ${1:_} ${2:_KEYWORD}', doc: '`#pragma shader_feature_local_fragment …` — local, stripped when unused, fragment stage only. Best fit for a fragment-only material toggle.' },
	{ name: 'shader_feature_local_vertex', snippet: 'shader_feature_local_vertex ${1:_} ${2:_KEYWORD}', doc: '`#pragma shader_feature_local_vertex …` — local, stripped when unused, vertex stage only (e.g. a vertex-wind toggle).' },
	{ name: 'multi_compile_instancing', doc: '`#pragma multi_compile_instancing` — builds `INSTANCING_ON` variants for GPU instancing. Needs `UNITY_VERTEX_INPUT_INSTANCE_ID` in the vertex input and `UNITY_SETUP_INSTANCE_ID(IN)` in the vertex shader. SRP Batcher usually makes it unnecessary.' },
	{ name: 'instancing_options', snippet: 'instancing_options ${1|assumeuniformscaling,nomatrices,nolightprobe,nolightmap,procedural:ConfigureProcedural,renderinglayer|}', doc: '`#pragma instancing_options …` — tweaks GPU instancing (e.g. `assumeuniformscaling`, `procedural:fn` for `DrawMeshInstancedIndirect`).' },
	{ name: 'multi_compile_fog', doc: '`#pragma multi_compile_fog` — builds `FOG_LINEAR`, `FOG_EXP`, `FOG_EXP2` variants. Use `ComputeFogFactor` in the vertex shader and `MixFog` in the fragment shader.' },
	{ name: 'skip_variants', snippet: 'skip_variants ${1:_KEYWORD}', doc: '`#pragma skip_variants A B` — removes variants that use these keywords, cutting compile time and size.' },
	{ name: 'only_renderers', snippet: 'only_renderers ${1|d3d11,glcore,gles,gles3,metal,vulkan,switch,ps4,ps5,xboxone,xboxseries|}', doc: '`#pragma only_renderers api …` — compile only for the listed graphics APIs.' },
	{ name: 'exclude_renderers', snippet: 'exclude_renderers ${1|d3d11,glcore,gles,gles3,metal,vulkan,switch,ps4,ps5,xboxone,xboxseries|}', doc: '`#pragma exclude_renderers api …` — skip the listed graphics APIs.' },
	{ name: 'editor_sync_compilation', doc: '`#pragma editor_sync_compilation` — compile the shader synchronously in the Editor instead of showing the "compiling" placeholder.' },
	{ name: 'enable_d3d11_debug_symbols', doc: '`#pragma enable_d3d11_debug_symbols` — embeds debug symbols for RenderDoc / PIX shader debugging.' },
	{ name: 'use_dxc', doc: '`#pragma use_dxc` — compile with DirectX Shader Compiler (Shader Model 6) on supported APIs.' },
	{ name: 'never_use_dxc', doc: '`#pragma never_use_dxc` — force the legacy FXC compiler.' },
	{ name: 'once', doc: '`#pragma once` — include guard: this file is included at most once per compilation unit. Supported by Unity\'s HLSL compiler.' },
];

export const PRAGMA_TARGETS = ['2.0', '3.0', '3.5', '4.0', '4.5', '4.6', '5.0'];
export const PRAGMA_RENDERERS = ['d3d11', 'glcore', 'gles', 'gles3', 'metal', 'vulkan', 'switch', 'ps4', 'ps5', 'xboxone', 'xboxseries', 'webgpu'];

/** Pragma directive names whose arguments are shader keywords. */
export const KEYWORD_PRAGMA_PATTERN = /^(multi_compile|shader_feature)(_local)?(_vertex|_fragment)?$/;
