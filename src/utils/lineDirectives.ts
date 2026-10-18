// Detects `#include "..."` and `Fallback "..."` directives on a single line, comment/string-aware
// (via commentMask), and returns the quoted value plus its character range so hover/definition
// providers can check whether the cursor falls inside it. Shared by hoverProvider and
// definitionProvider to avoid duplicating the detection logic.

import { maskLine } from './commentMask';

export interface DirectiveMatch {
	value: string;
	/** Character offset of the first character of the quoted value (exclusive of the quote itself). */
	start: number;
	/** Character offset just past the last character of the quoted value. */
	end: number;
}

/** True if `line[start, start+length)` is unchanged by masking, i.e. not inside a comment/string. */
function isRegionIntact(original: string, masked: string, start: number, length: number): boolean {
	return masked.substring(start, start + length) === original.substring(start, start + length);
}

function findDirective(line: string, regex: RegExp): DirectiveMatch | undefined {
	const match = regex.exec(line);
	if (!match || match[1] === undefined) {
		return undefined;
	}

	const quoteIndexInMatch = match[0].indexOf('"');
	const keywordLength = quoteIndexInMatch === -1 ? match[0].length : quoteIndexInMatch;
	const masked = maskLine(line).masked;
	if (!isRegionIntact(line, masked, match.index, keywordLength)) {
		// The keyword itself falls inside a comment or string — not a real directive.
		return undefined;
	}

	const valueStart = match.index + match[0].indexOf(match[1]);
	return { value: match[1], start: valueStart, end: valueStart + match[1].length };
}

export function findIncludeDirective(line: string): DirectiveMatch | undefined {
	return findDirective(line, /#include\s+"([^"]*)"/);
}

export function findFallbackDirective(line: string): DirectiveMatch | undefined {
	return findDirective(line, /\bFallback\s+"([^"]*)"/);
}
