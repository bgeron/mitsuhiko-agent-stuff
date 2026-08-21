import assert from "node:assert/strict";
import test from "node:test";

import { parseBtwCommandArgs } from "../extensions/btw.ts";

test("ordinary BTW prompts continue the current thread", () => {
	assert.deepEqual(parseBtwCommandArgs(" explain this change "), {
		fresh: false,
		question: "explain this change",
	});
	assert.deepEqual(parseBtwCommandArgs("--freshness matters"), {
		fresh: false,
		question: "--freshness matters",
	});
});

test("--fresh resets with or without an immediate prompt", () => {
	assert.deepEqual(parseBtwCommandArgs("--fresh"), {
		fresh: true,
		question: "",
	});
	assert.deepEqual(parseBtwCommandArgs("  --fresh   explain this change  "), {
		fresh: true,
		question: "explain this change",
	});
	assert.deepEqual(parseBtwCommandArgs("--fresh\ncompare these approaches"), {
		fresh: true,
		question: "compare these approaches",
	});
});
