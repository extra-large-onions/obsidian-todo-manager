import { Events, Plugin, TAbstractFile, TFile } from 'obsidian';
import { parseFile } from './parser';
import { dimensionsOf, treePathOf } from './tags';
import { Dimension, Item } from './types';

export interface IndexConfig {
	dimensions: Dimension[];
	treeDimId: string;
	debounceMs: number;
	rootFolder: string;
	scopeMode: 'all' | 'opt-in';   // 'opt-in' → only *.todo.md or frontmatter-marked files
	optInProperty: string;         // frontmatter key that opts a file in (e.g. "todos")
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
		const files = this.plugin.app.vault.getMarkdownFiles().filter(f => this.isScannable(f));
		for (const f of files) {
			await this.parseInto(f);
		}
		this.notifyChangedSoon();
	}

	/** Folder-scope gate only (path-based; cheap, no frontmatter lookup). */
	private inRootScope(path: string): boolean {
		return !this.config.rootFolder || path.startsWith(this.config.rootFolder + '/');
	}

	/**
	 * Full scan gate: folder scope, plus (in opt-in mode) the file must be named
	 * `*.todo.md` or carry a truthy `optInProperty` in its frontmatter.
	 */
	private isScannable(file: TFile): boolean {
		if (!this.inRootScope(file.path)) return false;
		if (this.config.scopeMode !== 'opt-in') return true;
		if (file.path.endsWith('.todo.md')) return true;
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const v = fm?.[this.config.optInProperty];
		return v !== undefined && v !== null && v !== false && v !== 'false' && v !== 0;
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
		// React if the file is in the folder scope or was already indexed. Opt-in
		// status is re-checked after the debounce, since the metadata cache can
		// lag the modify event (e.g. just added `todos: true` to frontmatter).
		if (!this.inRootScope(file.path) && !this.byFile.has(file.path)) return;
		const path = file.path;
		const existing = this.dirtyTimers.get(path);
		if (existing !== undefined) window.clearTimeout(existing);
		const timer = window.setTimeout(() => {
			this.dirtyTimers.delete(path);
			if (this.isScannable(file)) {
				void this.parseInto(file).then(() => this.notifyChangedSoon());
			} else if (this.byFile.delete(path)) {
				this.notifyChangedSoon();
			}
		}, this.config.debounceMs);
		this.dirtyTimers.set(path, timer);
	}

	private onDelete(file: TAbstractFile) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		if (this.byFile.delete(file.path)) this.notifyChangedSoon();
	}

	private onRename(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		const had = this.byFile.delete(oldPath);
		if (this.isScannable(file)) {
			void this.parseInto(file).then(() => this.notifyChangedSoon());
		} else if (had) {
			this.notifyChangedSoon();
		}
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

	/** Top-level items with no topic (heading section) and no tags — genuinely unfiled. */
	untagged(): Item[] {
		const out: Item[] = [];
		for (const items of this.byFile.values()) {
			for (const it of items) {
				if (it.tags.length === 0 && it.section.length === 0) out.push(it);
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
