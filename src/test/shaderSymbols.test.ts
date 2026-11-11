import * as assert from 'assert';
import { extractSymbols, findVariableStructType, keywordEnumKeyword } from '../analysis/shaderSymbols';
import { computeDiagnosticsForText } from '../providers/diagnosticsProvider';

const SHADER = `Shader "Custom/Test"
{
  Properties
  {
    [KeywordEnum(Two Colors, One Color)] _MODE ("Mode", Float) = 0
    [Header(Emission)]
    [Toggle(_EMISSION_ON)] _Emit ("Emit", Float) = 1
    [HDR] _Color1 ("Color 1", Color) = (1, 1, 1, 1)
    _MainTex ("Tex", 2D) = "white" {}
  }
  SubShader
  {
    Tags { "RenderPipeline" = "UniversalPipeline" }
    Pass
    {
      Tags { "LightMode" = "UniversalForward" }
      HLSLPROGRAM
      #pragma vertex vert
      #pragma fragment frag
      #pragma shader_feature_local _MODE_TWO_COLORS _MODE_ONE_COLOR
      #pragma shader_feature_local _EMISSION_ON
      #define BLINK 1

      struct VertexOutput
      {
        float4 vertex : SV_POSITION;
        float blink : TEXCOORD0;
      };

      // Doubles a value.
      float Twice(float x)
      {
        return x * 2.0;
      }

      VertexOutput vert(float4 p : POSITION)
      {
        VertexOutput OUT;
        OUT.vertex = p;
        return OUT;
      }
      half4 frag(VertexOutput IN) : SV_TARGET { return IN.blink; }
      ENDHLSL
    }
  }
}`;

suite('shaderSymbols', () => {
	test('KeywordEnum keywords are upper-cased with underscores', () => {
		assert.strictEqual(keywordEnumKeyword('_MODE', 'Two Colors'), '_MODE_TWO_COLORS');
	});

	test('extracts properties with attributes and driven keywords', () => {
		const { properties } = extractSymbols(SHADER);
		assert.deepStrictEqual(properties.map((p) => p.name), ['_MODE', '_Emit', '_Color1', '_MainTex']);
		assert.deepStrictEqual(properties[0].drivenKeywords, ['_MODE_TWO_COLORS', '_MODE_ONE_COLOR']);
		assert.deepStrictEqual(properties[1].drivenKeywords, ['_EMISSION_ON']);
		assert.ok(properties[2].attributes.includes('HDR'));
		assert.strictEqual(properties[3].type, '2D');
	});

	test('extracts functions, entry points, doc comments, structs and macros', () => {
		const symbols = extractSymbols(SHADER);
		const twice = symbols.functions.find((f) => f.name === 'Twice');
		assert.strictEqual(twice?.doc, 'Doubles a value.');
		assert.strictEqual(symbols.functions.find((f) => f.name === 'vert')?.entryPointOf, 'vertex');
		assert.strictEqual(symbols.functions.find((f) => f.name === 'frag')?.entryPointOf, 'fragment');
		assert.deepStrictEqual(symbols.structs[0].fields.map((f) => f.name), ['vertex', 'blink']);
		assert.deepStrictEqual(symbols.macros.map((m) => m.name), ['BLINK']);
	});

	test('does not mistake control flow or calls for functions', () => {
		const names = extractSymbols('void f() {\n if (a) {\n }\n else if (b) {\n }\n for (int i = 0; i < 2; i++) {\n }\n}').functions.map((f) => f.name);
		assert.deepStrictEqual(names, ['f']);
	});

	test('resolves the struct type of a declared variable', () => {
		const types = new Set(['VertexOutput', 'Light']);
		assert.strictEqual(findVariableStructType('half4 frag(VertexOutput IN) { Light l = x; ', 'IN', types), 'VertexOutput');
		assert.strictEqual(findVariableStructType('Light mainLight = GetMainLight();', 'mainLight', types), 'Light');
		assert.strictEqual(findVariableStructType('float4 IN;', 'IN', types), undefined);
	});
});

suite('keyword diagnostics', () => {
	test('a well-formed shader produces no keyword diagnostics', () => {
		assert.deepStrictEqual(computeDiagnosticsForText(SHADER), []);
	});

	test('flags a toggle keyword that no pragma declares', () => {
		const text = SHADER.replace('[Toggle(_EMISSION_ON)]', '[Toggle(_EMISSION_NO)]');
		const messages = computeDiagnosticsForText(text).map((d) => d.message);
		assert.ok(messages.some((m) => m.includes("'_EMISSION_NO'")), messages.join('\n'));
	});

	test('suggests the _local variant for material-driven keywords', () => {
		const text = SHADER.replace('shader_feature_local _EMISSION_ON', 'shader_feature _EMISSION_ON');
		const messages = computeDiagnosticsForText(text).map((d) => d.message);
		assert.ok(messages.some((m) => m.includes('shader_feature_local')), messages.join('\n'));
	});

	test('flags a typo in a keyword condition', () => {
		const text = SHADER.replace('float Twice(float x)', '#if defined(_EMISION_ON)\n#endif\nfloat Twice(float x)');
		const messages = computeDiagnosticsForText(text).map((d) => d.message);
		assert.ok(messages.some((m) => m.includes("did you mean '_EMISSION_ON'")), messages.join('\n'));
	});

	test('does not call user-defined functions misspelled built-ins', () => {
		const text = 'float GetMainLights(float x)\n{\n return x;\n}\nfloat y = GetMainLights(1);';
		assert.deepStrictEqual(computeDiagnosticsForText(text).filter((d) => d.message.includes('did you mean')), []);
	});
});
