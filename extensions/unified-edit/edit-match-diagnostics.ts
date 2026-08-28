export interface IndentationSummary {
	blankLines: number;
	unindentedLines: number;
	spaceIndentedLines: number;
	tabIndentedLines: number;
	mixedIndentedLines: number;
	leadingSpaceCounts: Record<string, number>;
	leadingTabCounts: Record<string, number>;
}

export interface FailedEditMatchDiagnostics {
	hunkLines: number;
	hunkCharacters: number;
	hunkIndentation: IndentationSummary;
	spacesPerTabOccurrences: Record<string, number>;
	indentInsensitiveOccurrences: number;
	collapsedHorizontalWhitespaceOccurrences: number;
	removedHorizontalWhitespaceOccurrences: number;
}

export function normalizeForFuzzyMatch(text: string): string {
	return text
		.normalize("NFKC")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
		.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
		.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
		.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function isWholeLineBoundary(content: string, start: number, length: number, needle: string): boolean {
	const end = start + length;
	const startsOnBoundary = start === 0 || content[start - 1] === "\n";
	const consumesTrailingNewline = needle.endsWith("\n");
	const endsOnBoundary = consumesTrailingNewline || end >= content.length || content[end] === "\n";
	return startsOnBoundary && endsOnBoundary;
}

function countNeedleOccurrences(content: string, needle: string, wholeLines: boolean): number {
	if (needle.length === 0) return 0;
	let count = 0;
	let index = content.indexOf(needle);
	while (index !== -1) {
		if (!wholeLines || isWholeLineBoundary(content, index, needle.length, needle)) count++;
		index = content.indexOf(needle, index + (wholeLines ? 1 : needle.length));
	}
	return count;
}

function mapLines(text: string, transform: (line: string) => string): string {
	return text.split("\n").map(transform).join("\n");
}

function expandLeadingTabs(line: string, tabWidth: number): string {
	const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
	if (!indent.includes("\t")) return line;

	let column = 0;
	for (const character of indent) {
		if (character === "\t") column += tabWidth - (column % tabWidth);
		else column++;
	}
	return `${" ".repeat(column)}${line.slice(indent.length)}`;
}

function countNormalizedOccurrences(
	content: string,
	oldText: string,
	wholeLines: boolean,
	normalize: (text: string) => string,
): number {
	return countNeedleOccurrences(normalize(content), normalize(oldText), wholeLines);
}

function incrementHistogram(histogram: Record<string, number>, value: number): void {
	const key = String(value);
	histogram[key] = (histogram[key] ?? 0) + 1;
}

export function summarizeIndentation(text: string): IndentationSummary {
	const summary: IndentationSummary = {
		blankLines: 0,
		unindentedLines: 0,
		spaceIndentedLines: 0,
		tabIndentedLines: 0,
		mixedIndentedLines: 0,
		leadingSpaceCounts: {},
		leadingTabCounts: {},
	};

	for (const line of text.split("\n")) {
		if (line.trim() === "") {
			summary.blankLines++;
			continue;
		}
		const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
		if (indent.length === 0) {
			summary.unindentedLines++;
			continue;
		}

		const spaces = indent.length - indent.replaceAll(" ", "").length;
		const tabs = indent.length - indent.replaceAll("\t", "").length;
		if (spaces > 0) incrementHistogram(summary.leadingSpaceCounts, spaces);
		if (tabs > 0) incrementHistogram(summary.leadingTabCounts, tabs);

		if (spaces > 0 && tabs > 0) summary.mixedIndentedLines++;
		else if (tabs > 0) summary.tabIndentedLines++;
		else summary.spaceIndentedLines++;
	}

	return summary;
}

export function diagnoseFailedEditMatch(
	content: string,
	oldText: string,
	wholeLines: boolean,
	maximumTabWidth = 16,
): FailedEditMatchDiagnostics {
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const spacesPerTabOccurrences: Record<string, number> = {};

	for (let tabWidth = 1; tabWidth <= maximumTabWidth; tabWidth++) {
		const occurrences = countNormalizedOccurrences(
			fuzzyContent,
			fuzzyOldText,
			wholeLines,
			(text) => mapLines(text, (line) => expandLeadingTabs(line, tabWidth)),
		);
		if (occurrences > 0) spacesPerTabOccurrences[String(tabWidth)] = occurrences;
	}

	return {
		hunkLines: oldText.length === 0 ? 0 : oldText.split("\n").length,
		hunkCharacters: oldText.length,
		hunkIndentation: summarizeIndentation(oldText),
		spacesPerTabOccurrences,
		indentInsensitiveOccurrences: countNormalizedOccurrences(
			fuzzyContent,
			fuzzyOldText,
			wholeLines,
			(text) => mapLines(text, (line) => line.replace(/^[ \t]+/, "")),
		),
		collapsedHorizontalWhitespaceOccurrences: countNormalizedOccurrences(
			fuzzyContent,
			fuzzyOldText,
			wholeLines,
			(text) => mapLines(text, (line) => line.replace(/[ \t]+/g, " ")),
		),
		removedHorizontalWhitespaceOccurrences: countNormalizedOccurrences(
			fuzzyContent,
			fuzzyOldText,
			wholeLines,
			(text) => mapLines(text, (line) => line.replace(/[ \t]+/g, "")),
		),
	};
}
