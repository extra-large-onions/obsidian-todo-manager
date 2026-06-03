import { ClassifiedTag, Dimension, Item } from './types';

export const DEFAULT_DIMENSIONS: Dimension[] = [
	{ id: 'tree', name: 'Tree', kind: 'tree', values: [] },
	{ id: 'type', name: 'Type', kind: 'auto', values: [] },
	{ id: 'added', name: 'Added', kind: 'time', values: [] },
	{ id: 'due', name: 'Due', kind: 'time', values: [] },
];

export const DEFAULT_TREE_DIMENSION_ID = 'tree';

/**
 * Classify a raw tag value against dimensions that have predetermined values
 * (tree, radio, checkbox). Exact match against values[]. Returns the dim id
 * of the first matching dim, or null (→ free bucket).
 * Time, text, and auto dims are never matched by tags.
 */
export function classifyTag(tag: string, dims: Dimension[]): string | null {
	for (const d of dims) {
		if (d.kind === 'time' || d.kind === 'text' || d.kind === 'auto') continue;
		if (d.values.includes(tag)) return d.id;
		// Tree dim with no predefined values auto-captures any hierarchical tag (contains /)
		if (d.kind === 'tree' && d.values.length === 0 && tag.includes('/')) return d.id;
	}
	return null;
}

/**
 * Group an item's tags + metadata by dimension.
 * Tags: exact match against values[], first match per tag wins.
 * Metadata: key matches dim id, value set directly.
 * For single-value dims (tree, radio, time, text): first value wins.
 * For checkbox: all values accumulate.
 * Auto dim: derived from item.kind + status.
 */
export function dimensionsOf(item: Item, dims: Dimension[], inheritedTags: string[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const allTags = Array.from(new Set([...inheritedTags, ...item.tags]));

	for (const tag of allTags) {
		const dimId = classifyTag(tag, dims);
		if (dimId === null) continue;
		const dim = dims.find(d => d.id === dimId)!;
		const arr = out.get(dimId) ?? [];
		if (dim.kind !== 'checkbox' && arr.length > 0) continue; // first wins
		arr.push(tag);
		out.set(dimId, arr);
	}

	for (const m of item.meta) {
		const dim = dims.find(d => d.id === m.key);
		if (!dim || dim.kind === 'auto') continue;
		const arr = out.get(dim.id) ?? [];
		if (dim.kind !== 'checkbox' && arr.length > 0) continue; // first wins
		arr.push(m.value);
		out.set(dim.id, arr);
	}

	const autoDim = dims.find(d => d.kind === 'auto');
	if (autoDim) {
		const typeVal = item.kind === 'task'
			? `task/${item.status ?? 'todo'}`
			: item.kind;
		out.set(autoDim.id, [typeVal]);
	}

	return out;
}

/** Tags on this item (own only) that don't match any dimension → free bucket. */
export function freeTags(item: Item, dims: Dimension[]): string[] {
	return item.tags.filter(t => classifyTag(t, dims) === null);
}

/** Tree-dimension path for grouping. Checks tags then metadata. */
export function treePathOf(item: Item, dims: Dimension[], inheritedTags: string[], treeDimId: string): string {
	const treeDim = dims.find(d => d.id === treeDimId);
	if (!treeDim) return '';
	const allTags = Array.from(new Set([...inheritedTags, ...item.tags]));
	for (const tag of allTags) {
		if (treeDim.values.includes(tag)) return tag;
		if (treeDim.values.length === 0 && tag.includes('/')) return tag;
	}
	for (const m of item.meta) {
		if (m.key === treeDimId) return m.value;
	}
	return '';
}

/** Test whether an item passes a filter set. filter[dimId] = required values (any-of). */
export function matchesFilter(
	item: Item,
	dims: Dimension[],
	inheritedTags: string[],
	filter: Map<string, Set<string>>,
): boolean {
	if (filter.size === 0) return true;
	const groups = dimensionsOf(item, dims, inheritedTags);
	for (const [dimId, required] of filter) {
		const have = groups.get(dimId) ?? [];
		const dim = dims.find(d => d.id === dimId);
		if (dim?.kind === 'tree' || dim?.kind === 'auto') {
			const ok = have.some(v => Array.from(required).some(r => v === r || v.startsWith(r + '/')));
			if (!ok) return false;
		} else {
			const ok = have.some(v => required.has(v));
			if (!ok) return false;
		}
	}
	return true;
}

// Re-export for callers that used ClassifiedTag before refactor.
export type { ClassifiedTag };
