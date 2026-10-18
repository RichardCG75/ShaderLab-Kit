// Masks `//`/`/* */` comments and string-literal contents to spaces so prefix/regex checks don't
// misfire inside them, while preserving line length and column positions.

export interface MaskResult {
	masked: string;
	/** Whether the line ended partway through an unterminated `/* *\/` block comment. */
	endsInBlockComment: boolean;
}

/** Masks a single line, given whether it starts already inside a block comment from a prior line. */
export function maskLine(line: string, startInBlockComment = false): MaskResult {
	let result = '';
	let inBlockComment = startInBlockComment;
	let inString: '"' | "'" | undefined;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		const next = line[i + 1];

		if (inBlockComment) {
			if (ch === '*' && next === '/') {
				result += '  ';
				i++;
				inBlockComment = false;
			} else {
				result += ' ';
			}
			continue;
		}

		if (inString) {
			if (ch === '\\' && next !== undefined) {
				result += '  ';
				i++;
				continue;
			}
			if (ch === inString) {
				inString = undefined;
			}
			result += ' ';
			continue;
		}

		if (ch === '/' && next === '/') {
			result += ' '.repeat(line.length - i);
			break;
		}
		if (ch === '/' && next === '*') {
			inBlockComment = true;
			result += '  ';
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = ch;
			result += ch;
			continue;
		}

		result += ch;
	}

	return { masked: result, endsInBlockComment: inBlockComment };
}

/** Masks every line of a multi-line document, tracking block-comment state across lines. */
export function maskDocument(text: string): string {
	let inBlockComment = false;
	return text
		.split(/\r\n|\r|\n/)
		.map((line) => {
			const { masked, endsInBlockComment } = maskLine(line, inBlockComment);
			inBlockComment = endsInBlockComment;
			return masked;
		})
		.join('\n');
}
