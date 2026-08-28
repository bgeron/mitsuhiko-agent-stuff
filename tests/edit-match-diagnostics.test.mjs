import assert from "node:assert/strict";
import test from "node:test";

import {
	diagnoseFailedEditMatch,
	summarizeIndentation,
} from "../extensions/unified-edit/edit-match-diagnostics.ts";

test("diagnoses four spaces written for each indentation tab", () => {
	const diagnostics = diagnoseFailedEditMatch(
		"fn main() {\n\tif ready {\n\t\trun();\n\t}\n}\n",
		"    if ready {\n        run();\n    }",
		true,
	);

	assert.deepEqual(diagnostics.spacesPerTabOccurrences, { 4: 1 });
	assert.equal(diagnostics.indentInsensitiveOccurrences, 1);
	assert.deepEqual(diagnostics.hunkIndentation.leadingSpaceCounts, {
		4: 2,
		8: 1,
	});
	assert.equal(diagnostics.hunkIndentation.spaceIndentedLines, 3);
	assert.equal(diagnostics.hunkIndentation.tabIndentedLines, 0);
});

test("reports the inferred tab width and relaxed-match ambiguity", () => {
	const diagnostics = diagnoseFailedEditMatch(
		"\tcall();\nother();\n\tcall();\n",
		"  call();",
		true,
	);

	assert.deepEqual(diagnostics.spacesPerTabOccurrences, { 2: 2 });
	assert.equal(diagnostics.indentInsensitiveOccurrences, 2);
});

test("distinguishes indentation-only and within-line whitespace mismatches", () => {
	const shiftedIndent = diagnoseFailedEditMatch("\t\tcall(arg);\n", "   call(arg);", true);
	assert.deepEqual(shiftedIndent.spacesPerTabOccurrences, {});
	assert.equal(shiftedIndent.indentInsensitiveOccurrences, 1);

	const withinLine = diagnoseFailedEditMatch("\tcall(first, second);\n", "\tcall(first,  second);", true);
	assert.equal(withinLine.indentInsensitiveOccurrences, 0);
	assert.equal(withinLine.collapsedHorizontalWhitespaceOccurrences, 1);
	assert.equal(withinLine.removedHorizontalWhitespaceOccurrences, 1);
});

test("indentation summaries separate spaces, tabs, mixed indentation, and blank lines", () => {
	assert.deepEqual(summarizeIndentation("plain\n  spaces\n\ttab\n \tmixed\n\t \n"), {
		blankLines: 2,
		unindentedLines: 1,
		spaceIndentedLines: 1,
		tabIndentedLines: 1,
		mixedIndentedLines: 1,
		leadingSpaceCounts: { 1: 1, 2: 1 },
		leadingTabCounts: { 1: 2 },
	});
});
