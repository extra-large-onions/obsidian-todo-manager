import { Item, ItemKind, MetaPair, TaskStatus } from './types';

interface ParseOptions {
	dimensionIds: string[];  // dimension ids to extract as key:value metadata
	path: string;
}

const TASK_RE = /^(\s*)[-*+]\s+\[(.)\]\s?(.*)$/;
const LIST_RE = /^(\s*)[-*+]\s+(.*)$/;
const TAG_RE = /(?:^|\s)#([A-Za-z][A-Za-z0-9/_-]*)/g;

function parseStatus(box: string): TaskStatus {
	switch (box.toLowerCase()) {
		case 'x': return 'done';
		case '/': return 'doing';
		case '-': return 'cancelled';
		default:  return 'todo';
	}
}

function extractTags(text: string): { tags: string[]; stripped: string } {
	const tags: string[] = [];
	const stripped = text.replace(TAG_RE, (_m: string, t: string) => {
		tags.push(t);
		return '';
	}).replace(/\s+/g, ' ').trim();
	return { tags, stripped };
}

function extractMeta(text: string, ids: string[]): { meta: MetaPair[]; stripped: string } {
	if (ids.length === 0) return { meta: [], stripped: text };
	const meta: MetaPair[] = [];
	const idPat = ids.map(escapeRe).join('|');

	// Primary: extract key:value pairs from %% ... %% comment blocks, then strip the block.
	// These are invisible in Obsidian's Reading / Live Preview modes.
	let stripped = text.replace(/%%([^%]*)%%/g, (_m, inner: string) => {
		const re = new RegExp(`(${idPat}):(\\S+)`, 'g');
		let m;
		while ((m = re.exec(inner)) !== null) meta.push({ key: m[1]!, value: m[2]! });
		return '';
	});

	// Fallback: plain key:value anywhere in the text (backwards compatibility).
	stripped = stripped.replace(new RegExp(`(?:^|\\s)(${idPat}):(\\S+)`, 'g'), (_m, k: string, v: string) => {
		meta.push({ key: k, value: v });
		return '';
	});

	return { meta, stripped: stripped.replace(/\s+/g, ' ').trim() };
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a markdown file's text into top-level items.
 * Children are nested by indent (any indent > parent's indent attaches as child).
 */
export function parseFile(text: string, opts: ParseOptions): Item[] {
	const lines = text.split(/\r?\n/);
	const top: Item[] = [];
	// stack of (indent, item) for current open ancestors
	const stack: Item[] = [];

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		if (raw === undefined) continue;
		if (raw.trim() === '') continue;

		const item = lineToItem(raw, i, opts);
		if (!item) continue;

		// pop ancestors with indent >= this item's indent
		while (stack.length > 0) {
			const top_ = stack[stack.length - 1]!;
			if (top_.loc.indent < item.loc.indent) break;
			stack.pop();
		}

		// index lines (non-list) only ever sit at top level
		if (item.kind === 'index') {
			stack.length = 0;
			top.push(item);
			continue;
		}

		if (stack.length === 0) {
			top.push(item);
		} else {
			stack[stack.length - 1]!.children.push(item);
		}
		stack.push(item);
	}

	return top;
}

function lineToItem(raw: string, lineNo: number, opts: ParseOptions): Item | null {
	const taskMatch = raw.match(TASK_RE);
	if (taskMatch) {
		const indent = taskMatch[1]!.length;
		const status = parseStatus(taskMatch[2]!);
		const body = taskMatch[3] ?? '';
		return makeItem('task', body, raw, lineNo, indent, opts, status);
	}
	const listMatch = raw.match(LIST_RE);
	if (listMatch) {
		const indent = listMatch[1]!.length;
		const body = listMatch[2] ?? '';
		return makeItem('knowledge', body, raw, lineNo, indent, opts);
	}
	// Plain non-list line: index entry (only at column 0; indented prose isn't an item).
	if (/^\S/.test(raw)) {
		return makeItem('index', raw, raw, lineNo, 0, opts);
	}
	return null;
}

function makeItem(
	kind: ItemKind,
	body: string,
	raw: string,
	lineNo: number,
	indent: number,
	opts: ParseOptions,
	status?: TaskStatus,
): Item {
	const { meta, stripped: noMeta } = extractMeta(body, opts.dimensionIds);
	const { tags, stripped: text } = extractTags(noMeta);
	return {
		kind,
		text,
		rawText: raw,
		loc: { path: opts.path, line: lineNo, indent },
		tags,
		meta,
		status,
		children: [],
	};
}

/** Effective tags = own tags ∪ ancestor tags. Walks the tree once. */
export function effectiveTags(item: Item, inherited: string[] = []): Map<Item, string[]> {
	const out = new Map<Item, string[]>();
	const own = Array.from(new Set([...inherited, ...item.tags]));
	out.set(item, own);
	for (const c of item.children) {
		for (const [k, v] of effectiveTags(c, own)) out.set(k, v);
	}
	return out;
}

/** Walk all items (including children) in a forest. */
export function walkItems(items: Item[]): Iterable<Item> {
	const out: Item[] = [];
	const stack = [...items];
	while (stack.length) {
		const it = stack.pop()!;
		out.push(it);
		for (let i = it.children.length - 1; i >= 0; i--) stack.push(it.children[i]!);
	}
	return out;
}
