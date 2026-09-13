import { IndexStore } from '../index-store';
import { parseFile } from '../parser';
import { dimensionIdsFor, dimensionsOf, freeTags, matchesFilter } from '../tags';
import { Dimension, Item } from '../types';
import { CanvasNodeData, buildHierarchy, getNodeText, groupDescendants, searchHaystack } from './canvas-api';

/** One item plus the tags it inherits from its ancestors. */
interface Entry {
	item: Item;
	inherited: string[];
}

export interface TaskCounts {
	total: number;
	open: number;       // todo + doing
	done: number;
	cancelled: number;
}

/** The same dimension filter the central view uses, plus free tags and a text query. */
export interface CanvasFilter {
	dims: Map<string, Set<string>>;
	tags: Set<string>;
	query: string;
}

export function emptyFilter(): CanvasFilter {
	return { dims: new Map(), tags: new Set(), query: '' };
}

export function filterActive(f: CanvasFilter): boolean {
	return f.dims.size > 0 || f.tags.size > 0 || f.query.trim() !== '';
}

function normalize(s: string): string {
	return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function flatten(items: Item[], inherited: string[], out: Entry[]): void {
	for (const item of items) {
		out.push({ item, inherited });
		const next = Array.from(new Set([...inherited, ...item.tags]));
		flatten(item.children, next, out);
	}
}

function countTasks(entries: Entry[]): TaskCounts {
	const c: TaskCounts = { total: 0, open: 0, done: 0, cancelled: 0 };
	for (const { item } of entries) {
		if (item.kind !== 'task') continue;
		c.total++;
		if (item.status === 'done') c.done++;
		else if (item.status === 'cancelled') c.cancelled++;
		else c.open++;
	}
	return c;
}

function addCounts(a: TaskCounts, b: TaskCounts): TaskCounts {
	return {
		total: a.total + b.total,
		open: a.open + b.open,
		done: a.done + b.done,
		cancelled: a.cancelled + b.cancelled,
	};
}

/** Effective tags of an entry (own ∪ inherited). */
function tagsOf(e: Entry): string[] {
	return Array.from(new Set([...e.inherited, ...e.item.tags]));
}

/**
 * The canvas seen as Project Items.
 *
 * Text nodes are run through the same parser as a markdown file, so a canvas
 * card gets real items — task statuses, `%% meta %%`, headings-as-topics — not
 * a checkbox regex. File nodes borrow the items the vault index already holds
 * for that file (narrowed to the linked heading when the node has a subpath),
 * which is the whole point of the merge: one parse, two surfaces.
 */
export class CanvasItems {
	private nodeById = new Map<string, CanvasNodeData>();
	private entriesByNode = new Map<string, Entry[]>();
	private descendantsOfGroup = new Map<string, string[]>();
	private order: CanvasNodeData[] = [];

	constructor(private store: IndexStore) {}

	rebuild(nodes: CanvasNodeData[], canvasPath: string): void {
		this.nodeById.clear();
		this.entriesByNode.clear();
		this.order = nodes;

		const dims = this.dims();
		const dimensionIds = dimensionIdsFor(dims);

		for (const node of nodes) {
			this.nodeById.set(node.id, node);
			const entries: Entry[] = [];
			if (node.type === 'file' && node.file) {
				flatten(this.fileItems(node), [], entries);
			} else {
				const text = getNodeText(node);
				if (text.trim() !== '') {
					// Synthetic path: canvas nodes have no line addresses in a file.
					const items = parseFile(text, { dimensionIds, path: `${canvasPath}#${node.id}` });
					flatten(items, [], entries);
				}
			}
			this.entriesByNode.set(node.id, entries);
		}

		this.descendantsOfGroup = groupDescendants(buildHierarchy(nodes));
	}

	/** Items the vault index holds for a file node, narrowed by its subpath. */
	private fileItems(node: CanvasNodeData): Item[] {
		const items = this.store.itemsForFile(node.file ?? '');
		const heading = (node.subpath ?? '').split('#').filter(s => s.trim() !== '').pop();
		if (!heading) return items;
		return items.filter(it => it.section.includes(heading));
	}

	private dims(): Dimension[] {
		return this.store.getConfig().dimensions;
	}

	nodes(): CanvasNodeData[] {
		return this.order;
	}

	node(id: string): CanvasNodeData | undefined {
		return this.nodeById.get(id);
	}

	counts(nodeId: string): TaskCounts {
		return countTasks(this.entriesByNode.get(nodeId) ?? []);
	}

	/** Counts for a group: its own card text plus everything inside it. */
	subtreeCounts(nodeId: string): TaskCounts {
		let total = this.counts(nodeId);
		for (const id of this.descendantsOfGroup.get(nodeId) ?? []) {
			total = addCounts(total, this.counts(id));
		}
		return total;
	}

	totals(): TaskCounts {
		let total: TaskCounts = { total: 0, open: 0, done: 0, cancelled: 0 };
		for (const id of this.entriesByNode.keys()) total = addCounts(total, this.counts(id));
		return total;
	}

	/** Does this node pass the filter? Groups pass when anything inside them does. */
	matches(nodeId: string, filter: CanvasFilter): boolean {
		if (this.matchesOwn(nodeId, filter)) return true;
		const node = this.nodeById.get(nodeId);
		if (node?.type !== 'group') return false;
		return (this.descendantsOfGroup.get(nodeId) ?? []).some(id => this.matchesOwn(id, filter));
	}

	private matchesOwn(nodeId: string, filter: CanvasFilter): boolean {
		const node = this.nodeById.get(nodeId);
		if (!node) return false;

		if (filter.query.trim() !== '') {
			const haystack = normalize([searchHaystack(node), this.itemText(nodeId)].join(' '));
			if (!haystack.includes(normalize(filter.query))) return false;
		}

		if (filter.dims.size === 0 && filter.tags.size === 0) return true;

		const entries = this.entriesByNode.get(nodeId) ?? [];
		const dims = this.dims();
		return entries.some(e => {
			if (filter.dims.size > 0 && !matchesFilter(e.item, dims, e.inherited, filter.dims)) return false;
			if (filter.tags.size > 0) {
				const have = tagsOf(e);
				const hit = have.some(t => Array.from(filter.tags).some(f => t === f || t.startsWith(`${f}/`)));
				if (!hit) return false;
			}
			return true;
		});
	}

	/** Item text of a node — lets Find reach into a file node's indexed items. */
	private itemText(nodeId: string): string {
		const entries = this.entriesByNode.get(nodeId) ?? [];
		return entries.map(e => e.item.text).join(' ');
	}

	/**
	 * Dimension values and free tags present on this canvas, with the number of
	 * nodes carrying each — the contents of the toolbar filter dropdown.
	 */
	presentValues(): { dims: Map<string, Map<string, number>>; tags: Map<string, number> } {
		const dims = this.dims();
		const byDim = new Map<string, Map<string, number>>();
		const tags = new Map<string, number>();

		for (const entries of this.entriesByNode.values()) {
			if (entries.length === 0) continue;
			// Count each value once per node, not once per item.
			const seen = new Map<string, Set<string>>();
			const seenTags = new Set<string>();
			for (const e of entries) {
				for (const [dimId, values] of dimensionsOf(e.item, dims, e.inherited)) {
					const dim = dims.find(d => d.id === dimId);
					// 'auto' is the task buttons; time/text values are dates and free text.
					if (!dim || dim.kind === 'auto' || dim.kind === 'time' || dim.kind === 'text') continue;
					const set = seen.get(dimId) ?? new Set<string>();
					for (const v of values) set.add(v);
					seen.set(dimId, set);
				}
				for (const t of freeTags(e.item, dims)) seenTags.add(t);
			}
			for (const [dimId, values] of seen) {
				const inner = byDim.get(dimId) ?? new Map<string, number>();
				for (const v of values) inner.set(v, (inner.get(v) ?? 0) + 1);
				byDim.set(dimId, inner);
			}
			for (const t of seenTags) tags.set(t, (tags.get(t) ?? 0) + 1);
		}
		return { dims: byDim, tags };
	}
}
