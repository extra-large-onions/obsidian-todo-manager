import { ItemView, Notice, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import { IndexStore } from '../index-store';
import { Dimension, Item } from '../types';
import { dimensionsOf, freeTags, matchesFilter, treePathOf } from '../tags';

export const VIEW_TYPE_PM_CENTRAL = 'pm-central-view';

// ---------- tree structures ----------

interface TreeNode {
	segment: string;
	fullPath: string;
	children: Map<string, TreeNode>;
	items: Item[];
}

// ---------- sprint structures ----------

// Consecutive zero-activity days that trigger a sprint boundary.
const SPRINT_GAP_DAYS = 2;

interface SprintGroup {
	number: number;
	label: string;
	items: Item[];
}

function daysBetween(a: string, b: string): number {
	return Math.round(Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

function sprintDateLabel(start: string, end: string): string {
	const ds = new Date(start);
	const de = new Date(end);
	const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	if (ds.getFullYear() === de.getFullYear() && ds.getMonth() === de.getMonth()) {
		return `${mo[ds.getMonth()]} ${ds.getDate()}–${de.getDate()}`;
	}
	return `${mo[ds.getMonth()]} ${ds.getDate()} – ${mo[de.getMonth()]} ${de.getDate()}`;
}

function computeSprints(itemsByDate: Map<string, Item[]>): SprintGroup[] {
	const activeDates = [...itemsByDate.keys()].sort();
	if (activeDates.length === 0) return [];

	const groups: SprintGroup[] = [];
	let batch: Item[] = [];
	let sprintStart = activeDates[0]!;
	let prev = activeDates[0]!;
	let num = 1;

	for (const date of activeDates) {
		if (daysBetween(prev, date) > SPRINT_GAP_DAYS && batch.length > 0) {
			groups.push({ number: num++, label: sprintDateLabel(sprintStart, prev), items: batch });
			batch = [];
			sprintStart = date;
		}
		batch.push(...(itemsByDate.get(date) ?? []));
		prev = date;
	}
	if (batch.length > 0) {
		groups.push({ number: num, label: sprintDateLabel(sprintStart, prev), items: batch });
	}
	return groups;
}

// ---------- type dim constants ----------

const TYPE_TASK_VALUES: { val: string; label: string; cls: string }[] = [
	{ val: 'task/todo',      label: 'Todo',      cls: 'pm-type-todo' },
	{ val: 'task/doing',     label: 'Doing',     cls: 'pm-type-doing' },
	{ val: 'task/done',      label: 'Done',      cls: 'pm-type-done' },
	{ val: 'task/cancelled', label: 'Discarded', cls: 'pm-type-cancelled' },
];

// ---------- view ----------

export class CentralView extends ItemView {
	private filter = new Map<string, Set<string>>();
	private groupMode: 'tree' | 'date' | 'sprint' = 'tree';
	private rerender: () => void;

	constructor(leaf: WorkspaceLeaf, private store: IndexStore) {
		super(leaf);
		this.rerender = debounce(() => this.render(), 80, true);
	}

	getViewType(): string { return VIEW_TYPE_PM_CENTRAL; }
	getDisplayText(): string { return 'Project items'; }
	getIcon(): string { return 'list-checks'; }

	async onOpen(): Promise<void> {
		this.registerEvent(this.store.on('changed', () => this.rerender()));
		this.render();
	}

	async onClose(): Promise<void> { /* nothing */ }

	private render(): void {
		const root = this.contentEl;
		const sidebarScroll = root.querySelector<HTMLElement>('.pm-sidebar')?.scrollTop ?? 0;
		const mainScroll = root.querySelector<HTMLElement>('.pm-main')?.scrollTop ?? 0;
		root.empty();
		root.addClass('pm-central');
		this.renderSidebar(root);
		this.renderMainArea(root);
		const newSidebar = root.querySelector<HTMLElement>('.pm-sidebar');
		const newMain = root.querySelector<HTMLElement>('.pm-main');
		if (newSidebar) newSidebar.scrollTop = sidebarScroll;
		if (newMain) newMain.scrollTop = mainScroll;
	}

	// ===== SIDEBAR =====

	private renderSidebar(root: HTMLElement): void {
		const sidebar = root.createDiv({ cls: 'pm-sidebar' });
		this.renderDimFilters(sidebar);
		this.renderTreeSection(sidebar);
		const foot = sidebar.createDiv({ cls: 'pm-sidebar-footer' });
		if (this.filter.size > 0) {
			foot.createEl('button', { text: 'Clear' })
				.addEventListener('click', () => { this.filter.clear(); this.render(); });
		}
		foot.createEl('button', { text: 'Rescan' })
			.addEventListener('click', () => void this.store.fullScan());
		foot.createEl('button', { text: 'Stamp dates' })
			.addEventListener('click', () => void this.stampDates());
	}

	private renderTreeSection(sidebar: HTMLElement): void {
		const cfg = this.store.getConfig();
		const byPath = this.store.byTreePath();

		// Count items per top-level segment
		const topCounts = new Map<string, number>();
		for (const [path, items] of byPath) {
			if (path === '') continue;
			const top = path.split('/')[0]!;
			topCounts.set(top, (topCounts.get(top) ?? 0) + items.length);
		}
		if (topCounts.size === 0) return;

		const sec = sidebar.createDiv({ cls: 'pm-sidebar-section' });
		sec.createDiv({ cls: 'pm-sidebar-label', text: 'Tree' });

		const treeDimId = cfg.treeDimId;
		const activeSet = this.filter.get(treeDimId);
		const activeVal = activeSet && activeSet.size === 1 ? [...activeSet][0]! : undefined;

		for (const [top, count] of [...topCounts.entries()].sort()) {
			const isActive = activeVal === top;
			const row = sec.createDiv({ cls: `pm-filter-option${isActive ? ' is-active' : ''}` });
			const input = row.createEl('input', { cls: 'pm-filter-input', attr: { type: 'radio', name: 'pm-tree-top' } });
			input.checked = isActive;
			row.createSpan({ cls: 'pm-filter-label-text', text: top });
			row.createSpan({ cls: 'pm-filter-count', text: String(count) });
			row.addEventListener('click', () => {
				if (isActive) this.filter.delete(treeDimId);
				else this.filter.set(treeDimId, new Set([top]));
				this.render();
			});
		}
	}

	private computeStats() {
		let tasks = 0, todo = 0, doing = 0, done = 0, cancelled = 0, knowledge = 0, index = 0;
		for (const { item } of this.store.allItemsWithInheritance()) {
			if (item.kind === 'task') {
				tasks++;
				if (item.status === 'doing') doing++;
				else if (item.status === 'done') done++;
				else if (item.status === 'cancelled') cancelled++;
				else todo++;
			} else if (item.kind === 'knowledge') {
				knowledge++;
			} else {
				index++;
			}
		}
		return { tasks, todo, doing, done, cancelled, knowledge, index, untagged: this.store.untagged().length };
	}

	// ---------- dim filters ----------

	private renderDimFilters(sidebar: HTMLElement): void {
		const cfg = this.store.getConfig();
		const kindOrder = (k: string) => k === 'auto' ? 0 : 1;
		const sorted = [...cfg.dimensions].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
		for (const dim of sorted) {
			if (dim.kind === 'time' || dim.kind === 'text' || dim.kind === 'tree') continue;
			const sec = sidebar.createDiv({ cls: 'pm-sidebar-section' });
			if (dim.kind === 'auto') this.renderAutoFilter(sec, dim);
			else if (dim.kind === 'radio') this.renderOptionFilter(sec, dim, 'radio');
			else if (dim.kind === 'checkbox') this.renderOptionFilter(sec, dim, 'checkbox');
		}
	}

	private renderAutoFilter(sec: HTMLElement, dim: Dimension): void {
		const s = this.computeStats();
		sec.createDiv({ cls: 'pm-sidebar-label', text: dim.name });

		// Tasks master row — controls all subtypes together
		const allSubVals = TYPE_TASK_VALUES.map(v => v.val);
		const activeSet = this.filter.get(dim.id) ?? new Set<string>();
		const activeSubs = allSubVals.filter(v => activeSet.has(v));
		const allActive = activeSubs.length === allSubVals.length;
		const someActive = activeSubs.length > 0;
		const taskRow = sec.createDiv({ cls: `pm-filter-option${someActive ? ' is-active' : ''}` });
		const taskInput = taskRow.createEl('input', { cls: 'pm-filter-input', attr: { type: 'checkbox' } });
		taskInput.checked = allActive;
		taskInput.indeterminate = someActive && !allActive;
		taskRow.createSpan({ cls: 'pm-filter-label-text', text: 'Tasks' });
		taskRow.createSpan({ cls: 'pm-filter-count', text: String(s.tasks) });
		taskRow.addEventListener('click', () => {
			const set = this.filter.get(dim.id) ?? new Set<string>();
			if (allActive) {
				for (const v of allSubVals) set.delete(v);
			} else {
				for (const v of allSubVals) set.add(v);
			}
			if (set.size === 0) this.filter.delete(dim.id); else this.filter.set(dim.id, set);
			this.render();
		});

		const taskSub = sec.createDiv({ cls: 'pm-filter-task-sub' });
		const taskCounts = [s.todo, s.doing, s.done, s.cancelled];
		for (let i = 0; i < TYPE_TASK_VALUES.length; i++) {
			const { val, label, cls } = TYPE_TASK_VALUES[i]!;
			this.renderFilterRow(taskSub, dim.id, val, label, cls, 'checkbox', taskCounts[i]);
		}

		this.renderFilterRow(sec, dim.id, 'knowledge', 'Knowledge', '', 'checkbox', s.knowledge);
		this.renderFilterRow(sec, dim.id, 'index', 'Index', '', 'checkbox', s.index);

		if (s.untagged > 0) {
			const warn = sec.createDiv({ cls: 'pm-filter-option pm-filter-warn' });
			warn.createSpan({ cls: 'pm-filter-label-text', text: `Untagged: ${s.untagged}` });
		}
	}

	private renderOptionFilter(sec: HTMLElement, dim: Dimension, mode: 'radio' | 'checkbox'): void {
		sec.createDiv({ cls: 'pm-sidebar-label', text: dim.name });
		if (dim.values.length === 0) {
			sec.createSpan({ cls: 'pm-filter-empty', text: 'No values defined.' });
			return;
		}
		for (const v of dim.values) {
			this.renderFilterRow(sec, dim.id, v, v, '', mode);
		}
	}

	private renderFilterRow(
		parent: HTMLElement,
		dimId: string,
		val: string,
		labelText: string,
		extraCls: string,
		mode: 'radio' | 'checkbox',
		count?: number,
	): void {
		const isActive = this.filter.get(dimId)?.has(val) ?? false;
		const row = parent.createDiv({ cls: `pm-filter-option${extraCls ? ` ${extraCls}` : ''}` });
		if (isActive) row.addClass('is-active');
		const input = row.createEl('input', { cls: 'pm-filter-input', attr: { type: mode } });
		if (mode === 'radio') input.setAttribute('name', `pm-dim-${dimId}`);
		input.checked = isActive;
		row.createSpan({ cls: 'pm-filter-label-text', text: labelText });
		if (count !== undefined) row.createSpan({ cls: 'pm-filter-count', text: String(count) });
		row.addEventListener('click', () => {
			if (mode === 'radio') {
				const cur = this.filter.get(dimId);
				if (cur?.has(val)) this.filter.delete(dimId);
				else this.filter.set(dimId, new Set([val]));
			} else {
				const set = this.filter.get(dimId) ?? new Set<string>();
				if (set.has(val)) set.delete(val); else set.add(val);
				if (set.size === 0) this.filter.delete(dimId); else this.filter.set(dimId, set);
			}
			this.render();
		});
	}

	// ===== MAIN AREA =====

	private renderMainArea(root: HTMLElement): void {
		const main = root.createDiv({ cls: 'pm-main' });
		const header = main.createDiv({ cls: 'pm-main-header' });
		const labels: Record<string, string> = { tree: 'Tree', date: 'Date', sprint: 'Sprint' };
		for (const mode of ['tree', 'date', 'sprint'] as const) {
			const btn = header.createEl('button', {
				cls: `pm-group-btn${this.groupMode === mode ? ' is-active' : ''}`,
				text: labels[mode]!,
			});
			btn.addEventListener('click', () => { this.groupMode = mode; this.render(); });
		}

		if (this.groupMode === 'tree') this.renderTreeView(main);
		else if (this.groupMode === 'date') this.renderDateView(main);
		else this.renderSprintView(main);
	}

	// ---------- tree grouping ----------

	private renderTreeView(main: HTMLElement): void {
		const tree = this.buildTree();
		if (tree.children.size === 0 && tree.items.length === 0) {
			main.createDiv({ cls: 'pm-empty', text: 'No items match.' });
			return;
		}
		this.renderTree(main, tree, 0);
	}

	private buildTree(): TreeNode {
		const cfg = this.store.getConfig();
		const root: TreeNode = { segment: '', fullPath: '', children: new Map(), items: [] };
		for (const [, items] of this.store.allFiles()) {
			for (const item of items) {
				if (!matchesFilter(item, cfg.dimensions, [], this.filter)) {
					if (!hasDescendantMatching(item, cfg.dimensions, item.tags, this.filter)) continue;
				}
				const path = treePathOf(item, cfg.dimensions, [], cfg.treeDimId);
				const segments = path === '' ? [''] : path.split('/');
				let node = root;
				let acc = '';
				for (const seg of segments) {
					acc = acc === '' ? seg : `${acc}/${seg}`;
					let next = node.children.get(seg);
					if (!next) { next = { segment: seg, fullPath: acc, children: new Map(), items: [] }; node.children.set(seg, next); }
					node = next;
				}
				node.items.push(item);
			}
		}
		return root;
	}

	private renderTree(parent: HTMLElement, node: TreeNode, depth: number): void {
		for (const child of [...node.children.values()].sort((a, b) => a.segment.localeCompare(b.segment))) {
			const section = parent.createDiv({ cls: 'pm-tree-section' });
			const hdr = section.createDiv({ cls: 'pm-tree-header' });
			hdr.style.paddingLeft = `${depth * 12}px`;
			hdr.createSpan({ cls: 'pm-tree-name', text: child.segment === '' ? '(uncategorized)' : child.segment });
			hdr.createSpan({ cls: 'pm-tree-count', text: ` ${countItems(child)}` });
			for (const it of child.items) this.renderItem(section, it, depth + 1, it.tags);
			this.renderTree(section, child, depth + 1);
		}
		if (depth === 0) {
			for (const it of node.items) this.renderItem(parent, it, 0, it.tags);
		}
	}

	// ---------- date grouping ----------

	private renderDateView(main: HTMLElement): void {
		const cfg = this.store.getConfig();
		const timeDimIds = cfg.dimensions.filter(d => d.kind === 'time').map(d => d.id);
		const groups = new Map<string, Item[]>();

		for (const [, items] of this.store.allFiles()) {
			for (const item of items) {
				if (!matchesFilter(item, cfg.dimensions, [], this.filter)) {
					if (!hasDescendantMatching(item, cfg.dimensions, item.tags, this.filter)) continue;
				}
				const dateVal = item.meta.find(m => timeDimIds.includes(m.key))?.value ?? '';
				const arr = groups.get(dateVal) ?? [];
				arr.push(item);
				groups.set(dateVal, arr);
			}
		}

		if (groups.size === 0) { main.createDiv({ cls: 'pm-empty', text: 'No items match.' }); return; }

		const dated = [...groups.keys()].filter(k => k !== '').sort();
		for (const key of dated) {
			const section = main.createDiv({ cls: 'pm-date-section' });
			section.createDiv({ cls: 'pm-date-header', text: key });
			for (const it of groups.get(key)!) this.renderItem(section, it, 0, it.tags);
		}
		const undated = groups.get('');
		if (undated) {
			const section = main.createDiv({ cls: 'pm-date-section' });
			section.createDiv({ cls: 'pm-date-header pm-date-undated', text: 'No date' });
			for (const it of undated) this.renderItem(section, it, 0, it.tags);
		}
	}

	// ---------- sprint grouping ----------

	private renderSprintView(main: HTMLElement): void {
		const cfg = this.store.getConfig();
		const timeDimIds = cfg.dimensions.filter(d => d.kind === 'time').map(d => d.id);
		const itemsByDate = new Map<string, Item[]>();
		const undated: Item[] = [];

		for (const [, items] of this.store.allFiles()) {
			for (const item of items) {
				if (!matchesFilter(item, cfg.dimensions, [], this.filter)) {
					if (!hasDescendantMatching(item, cfg.dimensions, item.tags, this.filter)) continue;
				}
				const dateVal = item.meta.find(m => timeDimIds.includes(m.key))?.value ?? '';
				if (dateVal === '') {
					undated.push(item);
				} else {
					const arr = itemsByDate.get(dateVal) ?? [];
					arr.push(item);
					itemsByDate.set(dateVal, arr);
				}
			}
		}

		const sprints = computeSprints(itemsByDate);

		if (sprints.length === 0 && undated.length === 0) {
			main.createDiv({ cls: 'pm-empty', text: 'No items match.' });
			return;
		}

		for (const sprint of sprints) {
			const section = main.createDiv({ cls: 'pm-sprint-section' });
			const hdr = section.createDiv({ cls: 'pm-sprint-header' });
			hdr.createSpan({ cls: 'pm-sprint-num', text: `Sprint ${sprint.number}` });
			hdr.createSpan({ cls: 'pm-sprint-range', text: sprint.label });
			hdr.createSpan({ cls: 'pm-sprint-count', text: `${sprint.items.length}` });
			for (const it of sprint.items) this.renderItem(section, it, 0, it.tags);
		}

		if (undated.length > 0) {
			const section = main.createDiv({ cls: 'pm-sprint-section' });
			section.createDiv({ cls: 'pm-sprint-header pm-sprint-undated', text: 'No date' });
			for (const it of undated) this.renderItem(section, it, 0, it.tags);
		}
	}

	// ---------- item rendering ----------

	private renderItem(parent: HTMLElement, item: Item, depth: number, inheritedTags: string[]): void {
		const cfg = this.store.getConfig();
		const row = parent.createDiv({ cls: `pm-item pm-item-${item.kind}` });
		row.style.paddingLeft = `${depth * 12 + 8}px`;

		if (item.kind === 'task') {
			const cb = row.createEl('input', { cls: 'pm-task-cb', attr: { type: 'checkbox' } });
			cb.checked = item.status === 'done';
			cb.addEventListener('click', e => { e.stopPropagation(); void this.toggleTask(item); });
			if (item.status) row.addClass(`pm-status-${item.status}`);
		} else if (item.kind === 'knowledge') {
			row.createSpan({ cls: 'pm-bullet', text: '•' });
		}

		row.createSpan({ cls: 'pm-item-text', text: item.text || '(empty)' });

		const chips = row.createSpan({ cls: 'pm-chips' });
		const groups = dimensionsOf(item, cfg.dimensions, inheritedTags.filter(t => !item.tags.includes(t)));
		for (const dim of cfg.dimensions) {
			// tree chips are redundant (item is already under tree node); auto chips visible from checkbox/bullet
			if (dim.kind === 'auto' || dim.id === cfg.treeDimId) continue;
			const vs = groups.get(dim.id);
			if (!vs) continue;
			for (const v of vs) chips.createSpan({ cls: `pm-chip pm-chip-${dim.id}`, text: v });
		}
		for (const t of freeTags(item, cfg.dimensions)) {
			chips.createSpan({ cls: 'pm-chip pm-chip-free', text: `#${t}` });
		}

		const nextInherited = Array.from(new Set([...inheritedTags, ...item.tags]));
		for (const c of item.children) this.renderItem(parent, c, depth + 1, nextInherited);
	}

	private async stampDates(): Promise<void> {
		const cfg = this.store.getConfig();
		const timeDimIds = new Set(cfg.dimensions.filter(d => d.kind === 'time').map(d => d.id));
		const dimId = cfg.dimensions.find(d => d.kind === 'time')?.id;
		if (!dimId) { new Notice('No time dimension configured.'); return; }

		const now = new Date();
		const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

		// Collect top-level non-index lines needing a stamp, grouped by file path.
		const toStamp = new Map<string, number[]>();
		for (const [, items] of this.store.allFiles()) {
			for (const item of items) {
				if (item.kind === 'index') continue;
				if (!item.meta.some(m => timeDimIds.has(m.key))) {
					const arr = toStamp.get(item.loc.path) ?? [];
					arr.push(item.loc.line);
					toStamp.set(item.loc.path, arr);
				}
			}
		}

		if (toStamp.size === 0) { new Notice('All items already have a date.'); return; }

		let count = 0;
		const commentRe = /%%([^%]*)%%/;
		for (const [path, lineNums] of toStamp) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const text = await this.app.vault.read(file);
			const lines = text.split(/\r?\n/);
			for (const n of lineNums) {
				if (lines[n] === undefined) continue;
				const existing = lines[n]!.match(commentRe);
				if (existing) {
					// Insert inside the existing comment block.
					lines[n] = lines[n]!.replace(commentRe, `%%${existing[1]!.trimEnd()} ${dimId}:${today} %%`);
				} else {
					lines[n] = lines[n]!.trimEnd() + ` %% ${dimId}:${today} %%`;
				}
				count++;
			}
			await this.app.vault.modify(file, lines.join('\n'));
		}
		new Notice(`Stamped ${count} item${count === 1 ? '' : 's'} with ${dimId}:${today}`);
	}

	private async toggleTask(item: Item): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(item.loc.path);
		if (!(file instanceof TFile)) return;
		const text = await this.app.vault.read(file);
		const lines = text.split(/\r?\n/);
		const line = lines[item.loc.line];
		if (line === undefined) return;
		const next = line.replace(/^(\s*[-*+]\s+\[)(.)(\])/, (_m: string, a: string, c: string, b: string) =>
			`${a}${c.toLowerCase() === 'x' ? ' ' : 'x'}${b}`,
		);
		if (next === line) return;
		lines[item.loc.line] = next;
		await this.app.vault.modify(file, lines.join('\n'));
	}
}

function countItems(node: TreeNode): number {
	let n = node.items.length;
	for (const c of node.children.values()) n += countItems(c);
	return n;
}

function hasDescendantMatching(item: Item, dims: ReturnType<IndexStore['getConfig']>['dimensions'], inherited: string[], filter: Map<string, Set<string>>): boolean {
	for (const c of item.children) {
		const ownInh = Array.from(new Set([...inherited, ...c.tags]));
		if (matchesFilter(c, dims, inherited, filter)) return true;
		if (hasDescendantMatching(c, dims, ownInh, filter)) return true;
	}
	return false;
}
