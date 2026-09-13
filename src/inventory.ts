import { IndexStore } from './index-store';
import { dimensionsOf, freeTags } from './tags';
import { Dimension, Item, ItemKind, TaskStatus } from './types';

/**
 * What the vault actually contains, measured against the declared dimensions.
 * The management tab shows this next to the dimension source so you can see
 * which declared values are unused, which tags nothing declares, and which
 * `%% key:value %%` metadata is being ignored because no dimension owns the key.
 */

export interface ValueUse {
	value: string;
	items: number;
	files: number;
	/** Present in the dimension's declared `values` list. */
	declared: boolean;
	/** A sample of the raw values seen (unknown metadata keys only). */
	samples?: string[];
}

export interface DimUse {
	dim: Dimension;
	values: ValueUse[];
	/** Items carrying any value for this dimension. */
	items: number;
	/** Declared values that never appear in the vault. */
	unused: string[];
}

export interface Inventory {
	files: number;
	items: number;
	byKind: Map<ItemKind, number>;
	byStatus: Map<TaskStatus, number>;
	dims: DimUse[];
	/** Tags on items that no dimension claims. */
	freeTags: ValueUse[];
	/** `key:value` metadata in the notes whose key isn't a dimension id. */
	unknownMeta: ValueUse[];
	/** Items carrying no value for any time dimension. */
	undated: number;
}

interface Tally { items: number; files: Set<string>; samples: Set<string> }

function tally(map: Map<string, Tally>, key: string, path: string, sample?: string): void {
	let t = map.get(key);
	if (!t) { t = { items: 0, files: new Set(), samples: new Set() }; map.set(key, t); }
	t.items++;
	t.files.add(path);
	if (sample !== undefined && t.samples.size < 5) t.samples.add(sample);
}

function toUses(map: Map<string, Tally>, declared: (v: string) => boolean, withSamples = false): ValueUse[] {
	const out: ValueUse[] = [];
	for (const [value, t] of map) {
		const use: ValueUse = { value, items: t.items, files: t.files.size, declared: declared(value) };
		if (withSamples && t.samples.size > 0) use.samples = [...t.samples];
		out.push(use);
	}
	return out.sort((a, b) => b.items - a.items || a.value.localeCompare(b.value));
}

// `%% added:2026-05-14 due:2026-06-01 %%` — the whole comment, then each pair.
const META_BLOCK_RE = /%%([^%]*)%%/g;
const META_PAIR_RE = /([A-Za-z][\w-]*):(\S+)/g;

/** Metadata keys written in a line that the parser didn't claim as a dimension. */
function unclaimedMeta(item: Item, dimIds: Set<string>): Array<[string, string]> {
	const out: Array<[string, string]> = [];
	let block: RegExpExecArray | null;
	META_BLOCK_RE.lastIndex = 0;
	while ((block = META_BLOCK_RE.exec(item.rawText)) !== null) {
		const inner = block[1] ?? '';
		let pair: RegExpExecArray | null;
		META_PAIR_RE.lastIndex = 0;
		while ((pair = META_PAIR_RE.exec(inner)) !== null) {
			const key = pair[1]!;
			if (!dimIds.has(key)) out.push([key, pair[2]!]);
		}
	}
	return out;
}

export function buildInventory(store: IndexStore): Inventory {
	const cfg = store.getConfig();
	const dims = cfg.dimensions;
	const dimIds = new Set(dims.map(d => d.id));
	const timeDimIds = new Set(dims.filter(d => d.kind === 'time').map(d => d.id));

	const perDim = new Map<string, Map<string, Tally>>();
	for (const d of dims) perDim.set(d.id, new Map());
	const tagTally = new Map<string, Tally>();
	const metaTally = new Map<string, Tally>();
	const byKind = new Map<ItemKind, number>();
	const byStatus = new Map<TaskStatus, number>();

	let items = 0;
	let undated = 0;

	for (const { item, inheritedTags } of store.allItemsWithInheritance()) {
		items++;
		const path = item.loc.path;
		byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
		if (item.kind === 'task') {
			const st = item.status ?? 'todo';
			byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
		}
		if (!item.meta.some(m => timeDimIds.has(m.key))) undated++;

		const groups = dimensionsOf(item, dims, inheritedTags);
		for (const [dimId, values] of groups) {
			const bucket = perDim.get(dimId);
			if (!bucket) continue;
			for (const v of values) tally(bucket, v, path);
		}
		for (const t of freeTags(item, dims)) tally(tagTally, t, path);
		for (const [key, value] of unclaimedMeta(item, dimIds)) tally(metaTally, key, path, value);
	}

	const dimUses: DimUse[] = dims.map(dim => {
		const bucket = perDim.get(dim.id) ?? new Map<string, Tally>();
		const values = toUses(bucket, v => dim.values.includes(v));
		return {
			dim,
			values,
			items: values.reduce((n, v) => n + v.items, 0),
			unused: dim.values.filter(v => !bucket.has(v)),
		};
	});

	return {
		files: [...store.allFiles()].length,
		items,
		byKind,
		byStatus,
		dims: dimUses,
		freeTags: toUses(tagTally, () => false),
		unknownMeta: toUses(metaTally, () => false, true),
		undated,
	};
}

/** Values seen in the vault that no dimension claims — candidates to declare. */
export function undeclaredValues(inv: Inventory): string[] {
	return inv.freeTags.map(t => t.value);
}
