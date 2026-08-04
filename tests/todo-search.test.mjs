import assert from "node:assert/strict";
import test from "node:test";

import { compareSortKeys, filterTodos, sortTodos } from "../extensions/todos.ts";

function todo(id, title, options = {}) {
	return {
		id,
		title,
		tags: options.tags ?? [],
		status: options.status ?? "open",
		created_at: options.createdAt ?? "2026-01-01T00:00:00.000Z",
		assigned_to_session: options.assignedTo,
	};
}

function ids(todos) {
	return todos.map((item) => item.id);
}

test("sort keys compare arbitrary tuple lengths and value types lexicographically", () => {
	const keys = [[1, "b"], [1, "a", 2], [0], [1, "a"]];

	assert.deepEqual(keys.sort(compareSortKeys), [[0], [1, "a"], [1, "a", 2], [1, "b"]]);
});

test("non-ID completed matches always follow non-completed matches", () => {
	const todos = [
		todo("aaaaaaaa", "search", { status: "closed" }),
		todo("bbbbbbbb", "incremental todo list search"),
		todo("cccccccc", "search", { status: "DoNe" }),
	];

	assert.deepEqual(ids(filterTodos(todos, "search")), ["bbbbbbbb", "aaaaaaaa", "cccccccc"]);
});

test("all-token fuzzy ID matches form the top bucket even when title scores better", () => {
	const todos = [
		todo("eeeeeeee", "ab 12"),
		todo("ab12cd34", "ab", { status: "closed", tags: ["12"] }),
	];

	assert.deepEqual(ids(filterTodos(todos, "ab 12")), ["ab12cd34", "eeeeeeee"]);
});

test("the ID bucket uses normal relevance without an assignment boost", () => {
	const currentSession = "current-session";
	const todos = [
		todo("a0b1cd34", "weaker ID match", { assignedTo: currentSession }),
		todo("ab12cd34", "stronger ID match"),
	];

	assert.deepEqual(ids(filterTodos(todos, "ab", currentSession)), ["ab12cd34", "a0b1cd34"]);
});

test("matching only some tokens against the ID does not exempt a completed todo", () => {
	const todos = [
		todo("ab12cd34", "needle", { status: "closed" }),
		todo("eeeeeeee", "ab needle"),
	];

	assert.deepEqual(ids(filterTodos(todos, "ab needle")), ["eeeeeeee", "ab12cd34"]);
});

test("only current-session assignment receives a finite relevance boost", () => {
	const currentSession = "current-session";
	const equallyRelevant = [
		todo("aaaaaaaa", "alpha work", { assignedTo: "other-session" }),
		todo("bbbbbbbb", "alpha work"),
		todo("cccccccc", "alpha work", { assignedTo: currentSession }),
	];
	assert.deepEqual(ids(filterTodos(equallyRelevant, "alpha", currentSession)), [
		"cccccccc",
		"aaaaaaaa",
		"bbbbbbbb",
	]);

	const modestDifference = [
		todo("aaaaaaaa", "a search"),
		todo("bbbbbbbb", "sear ch", { assignedTo: currentSession }),
	];
	assert.deepEqual(ids(filterTodos(modestDifference, "search", currentSession)), [
		"bbbbbbbb",
		"aaaaaaaa",
	]);

	const strongDifference = [
		todo("aaaaaaaa", "search task"),
		todo("bbbbbbbb", "sear ch", { assignedTo: currentSession }),
	];
	assert.deepEqual(ids(filterTodos(strongDifference, "search", currentSession)), [
		"aaaaaaaa",
		"bbbbbbbb",
	]);
});

test("empty-query ordering remains assigned, open, then completed", () => {
	const todos = [
		todo("aaaaaaaa", "closed", { status: "closed", createdAt: "2026-01-01T00:00:00Z" }),
		todo("bbbbbbbb", "newer", { createdAt: "2026-01-03T00:00:00Z" }),
		todo("cccccccc", "assigned", {
			assignedTo: "other-session",
			createdAt: "2026-01-04T00:00:00Z",
		}),
		todo("dddddddd", "older", { createdAt: "2026-01-02T00:00:00Z" }),
	];
	const sorted = sortTodos(todos);

	assert.deepEqual(ids(sorted), ["cccccccc", "dddddddd", "bbbbbbbb", "aaaaaaaa"]);
	assert.strictEqual(filterTodos(sorted, "", "current-session"), sorted);
});
