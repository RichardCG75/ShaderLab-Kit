// Curated Unity/URP (SRP) built-in functions and macros, written fresh for ShaderLab Kit (not
// ported from either reference repo) — see shaderlab-domain skill for the source list. HLSL/URP
// scope only; no legacy Cg-pipeline entries.

export type UrpBuiltinKind = 'function' | 'macro' | 'constant';

export interface UrpBuiltin {
	name: string;
	kind: UrpBuiltinKind;
	detail: string;
}

export const URP_BUILTINS: UrpBuiltin[] = [
	// SRP matrices
	{ name: 'UNITY_MATRIX_M', kind: 'constant', detail: 'Object-to-world transform matrix.' },
	{ name: 'UNITY_MATRIX_V', kind: 'constant', detail: 'World-to-view (camera) transform matrix.' },
	{ name: 'UNITY_MATRIX_P', kind: 'constant', detail: 'View-to-clip (projection) transform matrix.' },
	{ name: 'UNITY_MATRIX_VP', kind: 'constant', detail: 'World-to-clip transform matrix (view * projection).' },
	{ name: 'UNITY_MATRIX_I_M', kind: 'constant', detail: 'Inverse of the object-to-world transform matrix.' },

	// GPU instancing
	{ name: 'UNITY_SETUP_INSTANCE_ID', kind: 'macro', detail: 'Sets up the current instance ID for GPU instancing; call at the start of a vertex/fragment shader.' },
	{ name: 'UNITY_TRANSFER_INSTANCE_ID', kind: 'macro', detail: 'Copies the instance ID from the vertex input struct to the output struct.' },
	{ name: 'UNITY_ACCESS_INSTANCED_PROP', kind: 'macro', detail: 'Reads a per-instance property from an instanced property buffer.' },

	// HLSL/SRP texture macros (Common.hlsl)
	{ name: 'TEXTURE2D', kind: 'macro', detail: 'Declares a Texture2D resource.' },
	{ name: 'TEXTURE2D_ARRAY', kind: 'macro', detail: 'Declares a Texture2DArray resource.' },
	{ name: 'TEXTURECUBE', kind: 'macro', detail: 'Declares a TextureCube resource.' },
	{ name: 'SAMPLER', kind: 'macro', detail: 'Declares a SamplerState resource.' },
	{ name: 'SAMPLE_TEXTURE2D', kind: 'function', detail: 'SAMPLE_TEXTURE2D(tex, sampler, uv) — samples a Texture2D.' },
	{ name: 'SAMPLE_TEXTURE2D_LOD', kind: 'function', detail: 'SAMPLE_TEXTURE2D_LOD(tex, sampler, uv, lod) — samples a Texture2D at an explicit mip level.' },

	// URP space transforms (SpaceTransforms.hlsl)
	{ name: 'TransformObjectToWorld', kind: 'function', detail: 'TransformObjectToWorld(positionOS) — transforms an object-space position to world space.' },
	{ name: 'TransformWorldToHClip', kind: 'function', detail: 'TransformWorldToHClip(positionWS) — transforms a world-space position to homogeneous clip space.' },
	{ name: 'TransformObjectToHClip', kind: 'function', detail: 'TransformObjectToHClip(positionOS) — transforms an object-space position directly to clip space.' },
	{ name: 'TransformWorldToShadowCoord', kind: 'function', detail: 'TransformWorldToShadowCoord(positionWS) — computes the shadow-map coordinate for a world-space position.' },

	// URP lighting (Lighting.hlsl)
	{ name: 'GetMainLight', kind: 'function', detail: 'GetMainLight() / GetMainLight(shadowCoord) — returns the scene\'s main directional Light struct.' },
	{ name: 'GetAdditionalLightsCount', kind: 'function', detail: 'GetAdditionalLightsCount() — returns the number of additional (non-main) lights affecting the current object.' },
	{ name: 'GetAdditionalLight', kind: 'function', detail: 'GetAdditionalLight(i, positionWS) — returns the i-th additional Light struct at a world-space position.' },
	{ name: 'MainLightRealtimeShadow', kind: 'function', detail: 'MainLightRealtimeShadow(shadowCoord) — returns the main light\'s real-time shadow attenuation.' },
	{ name: 'UniversalFragmentPBR', kind: 'function', detail: 'UniversalFragmentPBR(inputData, surfaceData) — the URP physically-based lighting entry point.' },
	{ name: 'LightingPhysicallyBased', kind: 'function', detail: 'LightingPhysicallyBased(brdfData, light, normalWS, viewDirectionWS) — evaluates PBR lighting for a single light.' },

	// Time / animation globals
	{ name: '_Time', kind: 'constant', detail: 'float4 (t/20, t, t*2, t*3) — time since level load.' },
	{ name: '_SinTime', kind: 'constant', detail: 'float4 (sin(t/8), sin(t/4), sin(t/2), sin(t)) — sine of time.' },
	{ name: '_CosTime', kind: 'constant', detail: 'float4 (cos(t/8), cos(t/4), cos(t/2), cos(t)) — cosine of time.' },
	{ name: 'unity_DeltaTime', kind: 'constant', detail: 'float4 (dt, 1/dt, smoothDt, 1/smoothDt) — frame delta time.' },
	{ name: '_TimeParameters', kind: 'constant', detail: 'float3 (t, sin(t), cos(t)) — newer alternative to _Time.' },

	// Camera / screen globals
	{ name: '_WorldSpaceCameraPos', kind: 'constant', detail: 'float3 — camera position in world space.' },
	{ name: '_ProjectionParams', kind: 'constant', detail: 'float4 (x: 1 or -1 if projection flipped, y: near plane, z: far plane, w: 1/far plane).' },
	{ name: '_ScreenParams', kind: 'constant', detail: 'float4 (x: width, y: height, z: 1+1/width, w: 1+1/height).' },
	{ name: '_ZBufferParams', kind: 'constant', detail: 'float4 — parameters for linearizing depth buffer values.' },
	{ name: '_OrthoParams', kind: 'constant', detail: 'float4 (x: orthographic width, y: orthographic height, z: unused, w: 1 if orthographic, 0 if perspective).' },
	{ name: '_ScaledScreenParams', kind: 'constant', detail: 'float4 — like _ScreenParams but accounts for render scale.' },

	// Transform matrices/globals
	{ name: 'unity_ObjectToWorld', kind: 'constant', detail: 'float4x4 — object-to-world matrix (UNITY_MATRIX_M is typically defined in terms of this).' },
	{ name: 'unity_WorldToObject', kind: 'constant', detail: 'float4x4 — world-to-object matrix.' },
	{ name: 'unity_MatrixVP', kind: 'constant', detail: 'float4x4 — view-projection matrix.' },
	{ name: 'unity_MatrixV', kind: 'constant', detail: 'float4x4 — view matrix.' },
	{ name: 'unity_MatrixInvV', kind: 'constant', detail: 'float4x4 — inverse view matrix.' },
	{ name: 'unity_CameraProjection', kind: 'constant', detail: 'float4x4 — camera projection matrix.' },
	{ name: 'unity_CameraInvProjection', kind: 'constant', detail: 'float4x4 — inverse camera projection matrix.' },
	{ name: 'unity_StereoEyeIndex', kind: 'constant', detail: 'int — current eye index in VR/stereo rendering.' },

	// Texture property conventions (Unity's auto-generated naming pattern, not always-present globals)
	{ name: '_MainTex', kind: 'constant', detail: 'The conventional primary texture property name.' },
	{ name: '_MainTex_ST', kind: 'constant', detail: 'float4 (x,y: tiling, z,w: offset) — auto-generated for any texture property named _MainTex; use with TRANSFORM_TEX.' },
	{ name: '_MainTex_TexelSize', kind: 'constant', detail: 'float4 (x: 1/width, y: 1/height, z: width, w: height) — auto-generated for any texture property.' },
	{ name: '_CameraDepthTexture', kind: 'constant', detail: "The scene's depth texture (when enabled)." },
	{ name: '_CameraOpaqueTexture', kind: 'constant', detail: "The scene's opaque color texture / camera color (when enabled), for distortion/refraction effects." },
	{ name: '_CameraDepthNormalsTexture', kind: 'constant', detail: 'Encoded depth+normals texture (when enabled).' },

	// Additional SRP Core.hlsl helper functions
	{ name: 'TransformObjectToWorldDir', kind: 'function', detail: 'TransformObjectToWorldDir(dirOS) — transforms an object-space direction to world space.' },
	{ name: 'TransformWorldToObject', kind: 'function', detail: 'TransformWorldToObject(positionWS) — transforms a world-space position to object space.' },
	{ name: 'TransformWorldToViewDir', kind: 'function', detail: 'TransformWorldToViewDir(dirWS) — transforms a world-space direction to view space.' },
	{ name: 'TransformViewToHClip', kind: 'function', detail: 'TransformViewToHClip(positionVS) — transforms a view-space position to clip space.' },
	{ name: 'GetWorldSpaceViewDir', kind: 'function', detail: 'GetWorldSpaceViewDir(positionWS) — returns the (non-normalized) view direction from a world-space position to the camera.' },
	{ name: 'GetWorldSpaceNormalizeViewDir', kind: 'function', detail: 'GetWorldSpaceNormalizeViewDir(positionWS) — returns the normalized view direction from a world-space position to the camera.' },
	{ name: 'GetObjectToWorldMatrix', kind: 'function', detail: 'GetObjectToWorldMatrix() — returns the current object-to-world matrix.' },
	{ name: 'GetWorldToObjectMatrix', kind: 'function', detail: 'GetWorldToObjectMatrix() — returns the current world-to-object matrix.' },
	{ name: 'SafeNormalize', kind: 'function', detail: 'SafeNormalize(v) — normalizes a vector, returning zero instead of NaN for a zero-length input.' },
];
