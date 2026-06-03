import { Events, Plugin, TAbstractFile, TFile } from 'obsidian';
import { parseFile } from './parser';
import { dimensionsOf, treePathOf } from './tags';
import { Dimension, Item } from './types';

export interface IndexConfig {
	dimensions: Dimension[];
	treeDimId: string;
	debounceMs: number;
	rootFolder: string;
}

/**
 * In-memory index of parsed items per file. Updated incrementally on vault events.
 * Emits a single coarse 'changed' event (debounced) so views can re-render once per burst.
 */
export class IndexStore extends Events {
	private byFile = new Map<string, Item[]>();
	private dirtyTimers = new Map<string, number>();
	private notifyTimer: number | null = null;

	constructor(private plugin: Plugin, private config: IndexConfig) {
		super();
	}

	updateConfig(config: IndexConfig) {
		this.config = config;
		// re-parse everything because timeKeys/dimensions may have changed
		void this.fullScan();
	}

	getConfig(): IndexConfig {
		return this.config;
	}

	async start(): Promise<void> {
		await this.fullScan();
		const vault = this.plugin.app.vault;
		this.plugin.registerEvent(vault.on('modify', f => this.onModify(f)));
		this.plugin.registerEvent(vault.on('create', f => this.onModify(f)));
		this.plugin.registerEvent(vault.on('delete', f => this.onDelete(f)));
		this.plugin.registerEvent(vault.on('rename', (f, old) => this.onRename(f, old)));
	}

	async fullScan(): Promise<void> {
		this.byFile.clear();
		let files = this.plugin.app.vault.getMarkdownFiles();
		if (this.config.rootFolder) {
			const prefix = this.config.rootFolder + '/';
			files = files.filter(f => f.path.startsWith(prefix));
		}
		for (const f of files) {
			await this.parseInto(f);
		}
		this.notifyChangedSoon();
	}

	private isInScope(path: string): boolean {
		if (!this.config.rootFolder) return true;
		return path.startsWith(this.config.rootFolder + '/');
	}

	private async parseInto(file: TFile): Promise<void> {
		const text = await this.plugin.app.vault.cachedRead(file);
		const dimensionIds = this.config.dimensions
			.filter(d => d.kind !== 'auto')
			.map(d => d.id);
		const items = parseFile(text, { dimensionIds, path: file.path });
		this.byFile.set(file.path, items);
	}

	private onModify(file: TAbstractFile) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (!this.isInScope(file.path)) return;
		const path = file.path;
		const existing = this.dirtyTimers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			this.dirtyTimers.delete(path);
			void this.parseInto(file).then(() => this.notifyChangedSoon());
		}, this.config.debounceMs);
		this.dirtyTimers.set(path, timer);
	}

	private onDelete(file: TAbstractFile) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (!this.isInScope(file.path)) return;
		this.byFile.delete(file.path);
		this.notifyChangedSoon();
	}

	private onRename(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const newInScope = this.isInScope(file.path);
		const oldInScope = this.isInScope(oldPath);
		if (!newInScope && !oldInScope) return;
		this.byFile.delete(oldPath);
		if (!newInScope) {
			this.notifyChangedSoon();
			return;
		}
		void this.parseInto(file).then(() => this.notifyChangedSoon());
	}

	private notifyChangedSoon() {
		if (this.notifyTimer !== null) return;
		this.notifyTimer = window.setTimeout(() => {
			this.notifyTimer = null;
			this.trigger('changed');
		}, 50);
	}

	// ---------- queries ----------

	allFiles(): IterableIterator<[string, Item[]]> {
		return this.byFile.entries();
	}

	allTopItems(): Item[] {
		const out: Item[] = [];
		for (const items of this.byFile.values()) out.push(...items);
		return out;
	}

	/** Returns flat list of (item, inheritedTags) for every item in the vault. */
	allItemsWithInheritance(): Array<{ item: Item; inheritedTags: string[] }> {
		const out: Array<{ item: Item; inheritedTags: string[] }> = [];
		const visit = (it: Item, inherited: string[]) => {
			out.push({ item: it, inheritedTags: inherited });
			const next = Array.from(new Set([...inherited, ...it.tags]));
			for (const c of it.children) visit(c, next);
		};
		for (const items of this.byFile.values()) {
			for (const it of items) visit(it, []);
		}
		return out;
	}

	/** Distinct tag values appearing on any item (own or inherited) within a single file. */
	tagsInFile(path: string): Set<string> {
		const out = new Set<string>();
		const items = this.byFile.get(path);
		if (!items) return out;
		const visit = (it: Item, inherited: string[]) => {
			for (const t of it.tags) out.add(t);
			for (const t of inherited) out.add(t);
			const next = Array.from(new Set([...inherited, ...it.tags]));
			for (const c of it.children) visit(c, next);
		};
		for (const it of items) visit(it, []);
		return out;
	}

	/** Top-level items grouped by tree path (e.g. "deployment/startup-sequence"). */
	byTreePath(): Map<string, Item[]> {
		const grouped = new Map<string, Item[]>();
		for (const items of this.byFile.values()) {
			for (const it of items) {
				const path = treePathOf(it, this.config.dimensions, [], this.config.treeDimId);
				const arr = grouped.get(path) ?? [];
				arr.push(it);
				grouped.set(path, arr);
			}
		}
		return grouped;
	}

	/** Top-level items with no tags at all. */
	untagged(): Item[] {
		const out: Item[] = [];
		for (const items of this.byFile.values()) {
			for (const it of items) {
				if (it.tags.length === 0) out.push(it);
			}
		}
		return out;
	}

	/** Top-level items with no metadata for any time dimension. */
	untimed(): Item[] {
		const timeDimIds = new Set(
			this.config.dimensions.filter(d => d.kind === 'time').map(d => d.id),
		);
		const out: Item[] = [];
		for (const items of this.byFile.values()) {
			for (const it of items) {
				if (!it.meta.some(m => timeDimIds.has(m.key))) out.push(it);
			}
		}
		return out;
	}

	/** Distinct tags across the vault, grouped by dimension. */
	tagsByDimension(): Map<string, Set<string>> {
		const out = new Map<string, Set<string>>();
		for (const { item, inheritedTags } of this.allItemsWithInheritance()) {
			const dims = dimensionsOf(item, this.config.dimensions, inheritedTags);
			for (const [k, vs] of dims) {
				const set = out.get(k) ?? new Set<string>();
				for (const v of vs) set.add(v);
				out.set(k, set);
			}
		}
		return out;
	}
}
