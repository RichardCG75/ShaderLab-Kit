// Human-readable documentation for HLSL vertex-input / interpolant / system-value semantics, keyed
// by base name (numeric suffixes like TEXCOORD0/TEXCOORD1 share the base TEXCOORD doc — see
// `getSemanticDoc` below, which strips the trailing index before looking up).

export const HLSL_SEMANTIC_DOCS: Record<string, string> = {
	POSITION: 'Object-space vertex position, read by the vertex shader from the input mesh (`appdata`/`Attributes` struct). Not to be confused with `SV_POSITION`, which is the clip-space position the vertex shader *outputs*.',
	NORMAL: 'Object-space vertex normal vector.',
	TANGENT: 'Object-space vertex tangent vector, typically `float4` with the bitangent sign in `.w`.',
	BINORMAL: 'Object-space vertex binormal (bitangent) vector. Rarely used directly — most shaders reconstruct the bitangent from `NORMAL` and `TANGENT.w` instead.',
	COLOR: 'Per-vertex color, usually `float4` RGBA.',
	TEXCOORD: 'Vertex UV coordinate (or, on interpolants passed from vertex to fragment, an arbitrary user-defined value — the semantic just marks an interpolated slot). `TEXCOORD0` is the first UV channel; higher indices are additional UV channels or custom interpolated data.',
	BLENDWEIGHTS: 'Per-vertex skin blend weights, used with `BLENDINDICES` for skeletal/skinned mesh animation.',
	BLENDINDICES: 'Per-vertex bone indices for skeletal/skinned mesh animation, paired with `BLENDWEIGHTS`.',
	PSIZE: 'Point size, for point-sprite rendering.',
	DIFFUSE: 'Legacy fixed-function diffuse color input — rarely used in modern shaders (prefer `COLOR`).',
	TESSFACTOR: 'Legacy (Shader Model 3) tessellation factor input.',
	BORDERCOLOR: 'Sampler state: the border color used when texture address mode is set to clamp-to-border.',
	BLENDENABLE: 'Render/sampler state: enables alpha blending.',
	BLENDOP: 'Render state: the blend operation (Add/Subtract/etc.) for RGB channels.',
	BLENDOPALPHA: 'Render state: the blend operation (Add/Subtract/etc.) for the alpha channel.',

	SV_POSITION: 'Clip-space position. Required output of the vertex shader (`float4`) and, when used as a fragment shader input, gives the pixel\'s screen-space position (`.xy` in pixels, `.z` depth, `.w` is 1/clip-w).',
	SV_TARGET: 'Fragment shader output color, written to render target 0. Numbered variants (`SV_TARGET0`..`SV_TARGET7`) target specific render targets for multiple-render-target (MRT) rendering.',
	SV_DEPTH: 'Fragment shader output: overrides the depth value written to the depth buffer for this pixel, bypassing the standard rasterizer-interpolated depth. Disables early-depth-test optimizations when used.',
	SV_VERTEXID: 'The index of the vertex within the current draw call, starting at 0. Useful for procedural/index-based vertex generation without a vertex buffer.',
	SV_INSTANCEID: 'The index of the current instance within an instanced draw call, starting at 0. Used together with GPU instancing (`UNITY_SETUP_INSTANCE_ID`, etc.) to look up per-instance data.',
	SV_ISFRONTFACE: 'Fragment shader input (`bool`): true if the triangle is front-facing (per the current winding/culling state), false if back-facing. Useful for two-sided materials.',
	SV_DISPATCHTHREADID: 'Compute shader input: the global thread ID across the entire dispatch, computed from the group ID and thread-within-group ID.',
	SV_GROUPID: 'Compute shader input: the ID of the current thread group within the dispatch.',
	SV_GROUPINDEX: 'Compute shader input: the flattened (1D) index of the current thread within its thread group.',
	SV_GROUPTHREADID: 'Compute shader input: the 3D index of the current thread within its thread group (matches the `numthreads(x,y,z)` layout).',
	SV_CLIPDISTANCE: 'Vertex shader output: per-vertex user clip-plane distance(s); geometry is clipped where this value is negative.',
	SV_CULLDISTANCE: 'Vertex shader output: per-vertex user cull-plane distance(s); geometry is culled (not clipped, discarded whole) where this value is negative.',
	SV_COVERAGE: 'Fragment shader input/output: the MSAA sample coverage mask.',
	SV_PRIMITIVEID: 'The index of the current primitive (triangle) within the draw call.',
	SV_RENDERTARGETARRAYINDEX: 'Selects which slice of a texture array render target this primitive is rendered to (used with geometry-shader-based or VR/array rendering).',
	SV_VIEWPORTARRAYINDEX: 'Selects which viewport (of multiple configured viewports) this primitive is rendered to.',
	SV_SAMPLEINDEX: 'Fragment shader input: the index of the MSAA sample currently being shaded (requires per-sample shading).',
	SV_DOMAINLOCATION: 'Domain shader input: the barycentric/UV location within the tessellated patch.',
	SV_GSINSTANCEID: 'Geometry shader input: the instance index when geometry shader instancing is used.',
	SV_INSIDETESSFACTOR: 'Hull shader patch-constant output: interior tessellation factor(s) for the patch.',
	SV_OUTPUTCONTROLPOINTID: 'Hull shader input: the index of the control point currently being processed.',
	SV_TESSFACTOR: 'Hull shader patch-constant output: edge tessellation factor(s) for the patch.',
};

/** Strips a trailing numeric index (e.g. "TEXCOORD0" -> "TEXCOORD") to find the base semantic name. */
function baseSemanticName(name: string): string {
	return name.replace(/\d+$/, '');
}

/** Looks up documentation for an HLSL semantic, handling numbered variants (TEXCOORD0, COLOR1, ...)
 *  by falling back to the base semantic's doc with a note about the channel/slot index. */
export function getSemanticDoc(name: string): string | undefined {
	const exact = HLSL_SEMANTIC_DOCS[name];
	if (exact) {
		return exact;
	}
	const base = baseSemanticName(name);
	const index = name.slice(base.length);
	const baseDoc = HLSL_SEMANTIC_DOCS[base];
	if (!baseDoc || index === '') {
		return undefined;
	}
	return `${baseDoc}\n\n(Channel/slot index ${index}.)`;
}
