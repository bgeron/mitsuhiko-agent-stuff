import assert from "node:assert/strict";
import test from "node:test";

import { SessionManager } from "@earendil-works/pi-coding-agent";

import { parseBtwCommandArgs, seedSessionManager } from "../extensions/btw.ts";

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

test("BTW seed messages are stored in the session manager context", () => {
	const sessionManager = SessionManager.inMemory();
	const messages = [
		{ role: "user", content: "main conversation question", timestamp: 1 },
		{
			role: "assistant",
			content: [{ type: "text", text: "main conversation answer" }],
			provider: "test-provider",
			model: "test-model",
			api: "openai-responses",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: 2,
		},
	];

	seedSessionManager(sessionManager, messages);

	assert.deepEqual(sessionManager.buildSessionContext().messages, messages);
});
