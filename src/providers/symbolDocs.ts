// Markdown documentation builders shared by completion and hover for user-defined symbols (from
// shaderSymbols.ts), curated URP built-ins and ShaderLab syntax entries. vscode.MarkdownString only.

import * as vscode from 'vscode';
import type { SymbolOrigin } from '../analysis/documentSymbols';
import type { ShaderFunction, ShaderKeyword, ShaderMacro, ShaderProperty, ShaderStruct } from '../analysis/shaderSymbols';
import type { UrpBuiltin } from '../data/urpBuiltins';

function originNote(origin: SymbolOrigin | undefined): string {
	if (!origin?.file) {
		return '';
	}
	const name = origin.file.split(/[\\/]/).pop();
	return `\n\n_Defined in \`${name}\` (line ${origin.line + 1})_`;
}

export function propertyDoc(property: ShaderProperty): vscode.MarkdownString {
	const doc = new vscode.MarkdownString();
	doc.appendCodeblock(`${property.name} ("${property.label}", ${property.type}) = ${property.defaultValue}`, 'shaderlab');
	const shown = property.attributes.filter((a) => !/^Header\b/.test(a));
	if (shown.length > 0) {
		doc.appendMarkdown(`Attributes: ${shown.map((a) => `\`[${a}]\``).join(' ')}\n\n`);
	}
	if (property.drivenKeywords.length > 0) {
		doc.appendMarkdown(`Drives keyword${property.drivenKeywords.length > 1 ? 's' : ''}: ${property.drivenKeywords.map((k) => `\`${k}\``).join(', ')}\n\n`);
	}
	doc.appendMarkdown(property.type.startsWith('2D') || property.type.startsWith('3D') || property.type === 'Cube' || property.type === '2DArray'
		? '_Material texture property. Declare with `TEXTURE2D(name); SAMPLER(sampler_name);` **outside** the `UnityPerMaterial` CBUFFER; its `name_ST` vector goes inside._'
		: '_Material property. Declare it with a matching type inside the `UnityPerMaterial` CBUFFER (same layout in every pass) to stay SRP Batcher compatible._');
	return doc;
}

export function keywordDoc(keyword: ShaderKeyword): vscode.MarkdownString {
	const doc = new vscode.MarkdownString();
	doc.appendMarkdown(`**${keyword.name}** — shader keyword\n\n`);
	if (keyword.drivenBy) {
		doc.appendMarkdown(`Set by material property \`${keyword.drivenBy}\`.\n\n`);
	}
	if (keyword.pragmas.length > 0) {
		doc.appendMarkdown(`Declared by ${keyword.pragmas.map((p) => `\`#pragma ${p}\``).join(', ')}.`);
		if (keyword.pragmas.every((p) => /^shader_feature/.test(p))) {
			doc.appendMarkdown(' Variants are stripped from builds unless a material enables them; if script toggles this keyword at runtime, use `multi_compile_local`.');
		} else if (keyword.pragmas.every((p) => /^multi_compile/.test(p))) {
			doc.appendMarkdown(' All variants are always compiled into the build.');
		}
	} else {
		doc.appendMarkdown('⚠ Not declared by any `#pragma` in this file, so enabling it has no effect.');
	}
	return doc;
}

export function functionDoc(fn: ShaderFunction, origin?: SymbolOrigin): vscode.MarkdownString {
	const doc = new vscode.MarkdownString();
	doc.appendCodeblock(`${fn.returnType} ${fn.name}(${fn.params})`, 'hlsl');
	if (fn.entryPointOf) {
		doc.appendMarkdown(`_${fn.entryPointOf[0].toUpperCase()}${fn.entryPointOf.slice(1)} shader entry point (\`#pragma ${fn.entryPointOf} ${fn.name}\`)._\n\n`);
	}
	if (fn.doc) {
		doc.appendMarkdown(fn.doc);
	}
	doc.appendMarkdown(originNote(origin));
	return doc;
}

export function macroDoc(macro: ShaderMacro, origin?: SymbolOrigin): vscode.MarkdownString {
	const doc = new vscode.MarkdownString();
	doc.appendCodeblock(`#define ${macro.name}${macro.params !== undefined ? `(${macro.params})` : ''} ${macro.value}`.trimEnd(), 'hlsl');
	doc.appendMarkdown(originNote(origin));
	return doc;
}

export function structDoc(struct: ShaderStruct, origin?: SymbolOrigin): vscode.MarkdownString {
	const doc = new vscode.MarkdownString();
	const body = struct.fields.map((f) => `\t${f.type} ${f.name}${f.semantic ? ` : ${f.semantic}` : ''};`).join('\n');
	doc.appendCodeblock(`struct ${struct.name}\n{\n${body}\n}`, 'hlsl');
	doc.appendMarkdown(originNote(origin));
	return doc;
}

export function builtinDoc(builtin: UrpBuiltin): vscode.MarkdownString {
	const doc = new vscode.MarkdownString(builtin.detail);
	if (builtin.source) {
		doc.appendMarkdown(`\n\n_Defined in \`${builtin.source}\`_`);
	}
	return doc;
}

export function entryDoc(text: string): vscode.MarkdownString {
	return new vscode.MarkdownString(text);
}
