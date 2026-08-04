import { fuzzyMatch } from "@earendil-works/pi-tui";

export interface TodoSearchRecord {
	id: string;
	title: string;
	tags: string[];
	status: string;
	created_at: string;
	assigned_to_session?: string;
}

export function isTodoClosed(status: string): boolean {
	return ["closed", "done"].includes(status.toLowerCase());
}

export type SortKey = readonly (number | string)[];

export function compareSortKeys(a: SortKey, b: SortKey): number {
	const length = Math.min(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const aValue = a[index];
		const bValue = b[index];
		if (aValue === bValue) continue;
		if (typeof aValue === "number" && typeof bValue === "number") {
			return aValue - bValue;
		}
		return String(aValue).localeCompare(String(bValue));
	}
	return a.length - b.length;
}

type TodoListSortKey = readonly [
	completed: number,
	unassigned: number,
	createdAt: string,
	originalIndex: number,
];

function buildTodoListSortKey(todo: TodoSearchRecord, index: number): TodoListSortKey {
	const completed = isTodoClosed(todo.status);
	return [
		completed ? 1 : 0,
		!completed && todo.assigned_to_session ? 0 : 1,
		todo.created_at || "",
		index,
	];
}

export function sortTodos<T extends TodoSearchRecord>(todos: T[]): T[] {
	return todos
		.map((todo, index) => ({ todo, sortKey: buildTodoListSortKey(todo, index) }))
		.sort((a, b) => compareSortKeys(a.sortKey, b.sortKey))
		.map(({ todo }) => todo);
}

type TodoSearchField = {
	text: string;
	priority: number;
	penalty: number;
};

type TodoSearchFieldMatch = {
	sortKey: readonly [score: number, priority: number];
};

const TODO_ID_PREFIX = "TODO-";
const TODO_SEARCH_CURRENT_SESSION_BOOST = 30;
const TODO_SEARCH_BUCKET = {
	idMatch: 0,
	active: 1,
	completed: 2,
} as const;

type TodoSearchSortKey = readonly [
	bucket: number,
	effectiveScore: number,
	fieldPriority: number,
	originalIndex: number,
];

function formatTodoId(id: string): string {
	return `${TODO_ID_PREFIX}${id}`;
}

function getTodoIdSearchText(todo: TodoSearchRecord): string {
	return `${formatTodoId(todo.id)} ${todo.id}`;
}

function buildTodoSearchFields(todo: TodoSearchRecord): TodoSearchField[] {
	const tags = todo.tags.join(" ");
	const fields: TodoSearchField[] = [
		{ text: todo.title, priority: 0, penalty: 0 },
		{ text: getTodoIdSearchText(todo), priority: 1, penalty: 10 },
		{ text: tags, priority: 2, penalty: 25 },
		{ text: todo.status, priority: 3, penalty: 40 },
	];
	if (todo.assigned_to_session) {
		fields.push({ text: `assigned:${todo.assigned_to_session}`, priority: 4, penalty: 80 });
	}
	return fields.filter((field) => field.text.trim());
}

function findBestTodoSearchFieldMatch(
	token: string,
	fields: TodoSearchField[],
): TodoSearchFieldMatch | null {
	let bestMatch: TodoSearchFieldMatch | null = null;
	for (const field of fields) {
		const result = fuzzyMatch(token, field.text);
		if (!result.matches) continue;
		const score = result.score + field.penalty;
		const match: TodoSearchFieldMatch = { sortKey: [score, field.priority] };
		if (!bestMatch || compareSortKeys(match.sortKey, bestMatch.sortKey) < 0) {
			bestMatch = match;
		}
	}
	return bestMatch;
}

function buildTodoSearchSortKey(
	todo: TodoSearchRecord,
	tokens: string[],
	totalScore: number,
	totalFieldPriority: number,
	originalIndex: number,
	currentSessionId?: string,
): TodoSearchSortKey {
	const idSearchText = getTodoIdSearchText(todo);
	const idBucket = tokens.every((token) => fuzzyMatch(token, idSearchText).matches);
	const currentSessionBoost =
		currentSessionId && todo.assigned_to_session === currentSessionId
			? TODO_SEARCH_CURRENT_SESSION_BOOST
			: 0;
	const bucket = idBucket
		? TODO_SEARCH_BUCKET.idMatch
		: isTodoClosed(todo.status)
			? TODO_SEARCH_BUCKET.completed
			: TODO_SEARCH_BUCKET.active;
	const effectiveScore = idBucket ? totalScore : totalScore - currentSessionBoost;
	return [bucket, effectiveScore, totalFieldPriority, originalIndex];
}

export function filterTodos<T extends TodoSearchRecord>(
	todos: T[],
	query: string,
	currentSessionId?: string,
): T[] {
	const trimmed = query.trim();
	if (!trimmed) return todos;

	const tokens = trimmed
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);

	if (tokens.length === 0) return todos;

	const matches: Array<{ todo: T; sortKey: TodoSearchSortKey }> = [];
	for (const [index, todo] of todos.entries()) {
		const fields = buildTodoSearchFields(todo);
		let totalScore = 0;
		let totalFieldPriority = 0;
		let matched = true;
		for (const token of tokens) {
			const bestMatch = findBestTodoSearchFieldMatch(token, fields);
			if (!bestMatch) {
				matched = false;
				break;
			}
			totalScore += bestMatch.sortKey[0];
			totalFieldPriority += bestMatch.sortKey[1];
		}
		if (matched) {
			matches.push({
				todo,
				sortKey: buildTodoSearchSortKey(
					todo,
					tokens,
					totalScore,
					totalFieldPriority,
					index,
					currentSessionId,
				),
			});
		}
	}

	return matches
		.sort((a, b) => compareSortKeys(a.sortKey, b.sortKey))
		.map((match) => match.todo);
}
