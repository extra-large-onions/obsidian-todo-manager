import { ItemView, Notice, TAbstractFile, WorkspaceLeaf, debounce } from 'obsidian';
import {
	CanvasInternal,
	CanvasNodeData,
	CanvasTreeNode,
	autoResizeNodes,
	buildHierarchy,
	countDescendants,
	countWords,
	getActiveCanvas,
	getCanvasData,
	getNodeDisplayName,
	openCanvases,
	zoomToNode,
} from '../canvas/canvas-api';
import { CanvasFilter, CanvasItems, TaskCounts, emptyFilter, filterActive } from '../canvas/canvas-items';
import { IndexStore } from '../index-store';

export const VIEW_TYPE_PM_CANVAS = 'pm-canvas-view';

type TaskMode = 'any' | 'open' | 'done';

/** Task buttons write these values into the 'auto' (Type) dimension filter. */
const TASK_MODE_VALUES: Record<TaskMode, string[]> = {
	any: [],
	open: ['task/todo', 'task/doing'],
	done: ['task/done'],
};

/**
 * The canvas surface of Project Items.
 *
 * A sidebar with the canvas containment hierarchy plus a toolbar floating over
 * the canvas itself. Filters are the same dimension filters as the central
 * view — a canvas card and a markdown bullet are the same kind of item here —
 * and non-matching nodes are dimmed rather than hidden, so the spatial layout
 * you built is never disturbed.
 */
export class CanvasView extends ItemView {
	private items: CanvasItems;
	private filter: CanvasFilter = emptyFilter();
	private taskMode: TaskMode = 'any';

	private canvasPath: string | null = null;
	private tree: CanvasTreeNode[] = [];
	private collapsedGroups = new Set<string>();

	// Toolbar (lives in the canvas DOM, not in this view)
	private toolbarEl: HTMLElement | null = null;
	private dropdownEl: HTMLElement | null = null;
	private filterBtnEl: HTMLButtonElement | null = null;
	private taskWrapEl: HTMLElement | null = null;
	private outsideClick: ((e: MouseEvent) => void) | null = null;

	// Sidebar
	private infoLineEl!: HTMLElement;
	private hierarchyEl!: HTMLElement;
	private footerEl!: HTMLElement;

	// Canvas virtualises nodes: re-apply dimming when elements come back.
	private canvasObserver: MutationObserver | null = null;
	private reapply: () => void;
	private scheduleRebuild: () => void;
	private searchDebounce = 0;

	constructor(leaf: WorkspaceLeaf, private store: IndexStore) {
		super(leaf);
		this.items = new CanvasItems(store);
		this.reapply = debounce(() => this.applyFilters(), 60, true);
		this.scheduleRebuild = debounce(() => this.rebuild(), 150, true);
	}

	getViewType(): string { return VIEW_TYPE_PM_CANVAS; }
	getDisplayText(): string { return 'Canvas items'; }
	getIcon(): string { return 'layout-dashboard'; }

	async onOpen(): Promise<void> {
		this.buildSidebar();
		this.attachToCanvas();

		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.attachToCanvas()));
		this.registerEvent(this.app.workspace.on('file-open', file => {
			if (file?.extension === 'canvas') this.attachToCanvas();
		}));
		// The canvas file is rewritten on every edit — cheaper and timelier than polling.
		this.registerEvent(this.app.vault.on('modify', (f: TAbstractFile) => {
			if (f.path === this.canvasPath) this.scheduleRebuild();
		}));
		// A markdown file changed: file nodes borrow their items from the index.
		this.registerEvent(this.store.on('changed', () => this.scheduleRebuild()));

		// Canvas selection has no event to hook; a slow tick keeps the count honest.
		this.registerInterval(window.setInterval(() => this.refreshInfoLine(), 4000));
	}

	async onClose(): Promise<void> {
		this.detachToolbar();
		this.clearCanvasDecoration();
	}

	// ═══ Canvas plumbing ══════════════════════════════════════════════════════

	private canvas(): CanvasInternal | null {
		return getActiveCanvas(this.app)?.canvas ?? null;
	}

	/** Point the view at whichever canvas is now in front, and re-read it. */
	private attachToCanvas(): void {
		this.clearCanvasDecoration();
		this.detachToolbar();

		const active = getActiveCanvas(this.app);
		this.canvasPath = active?.file?.path ?? null;
		if (!active) {
			this.tree = [];
			this.items.rebuild([], '');
			this.renderHierarchy();
			this.refreshInfoLine();
			return;
		}

		const container = active.canvas.wrapperEl ?? active.canvas.canvasEl?.parentElement ?? null;
		if (container) {
			this.toolbarEl = container.createDiv({ cls: 'pmc-canvas-toolbar' });
			this.buildToolbar(this.toolbarEl);
			this.observeCanvas(container);
		}
		this.rebuild();
	}

	/** Re-read the canvas, re-derive items, and refresh everything that shows them. */
	private rebuild(): void {
		const canvas = this.canvas();
		const nodes = canvas ? getCanvasData(canvas).nodes : [];
		this.items.rebuild(nodes, this.canvasPath ?? '');
		this.tree = buildHierarchy(nodes);
		this.refreshInfoLine();
		this.renderHierarchy();
		this.buildTaskButtons();
		this.applyFilters();
	}

	private observeCanvas(container: HTMLElement): void {
		this.canvasObserver?.disconnect();
		this.canvasObserver = new MutationObserver(mutations => {
			const restored = mutations.some(m => Array.from(m.addedNodes).some(n =>
				n instanceof HTMLElement && (n.hasClass('canvas-node') || n.querySelector('.canvas-node') !== null),
			));
			if (restored) this.reapply();
		});
		this.canvasObserver.observe(container, { childList: true, subtree: true });
	}

	private detachToolbar(): void {
		this.closeDropdown();
		this.canvasObserver?.disconnect();
		this.canvasObserver = null;
		this.toolbarEl?.remove();
		this.toolbarEl = null;
		this.taskWrapEl = null;
		this.filterBtnEl = null;
	}

	private clearCanvasDecoration(): void {
		for (const canvas of openCanvases(this.app)) {
			for (const node of canvas.nodes.values()) {
				node.nodeEl?.removeClasses(['pmc-node-dimmed', 'pmc-node-active']);
			}
		}
	}

	// ═══ Sidebar ══════════════════════════════════════════════════════════════

	private buildSidebar(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('pmc-sidebar');

		this.infoLineEl = root.createDiv({ cls: 'pmc-info-line' });

		const head = root.createDiv({ cls: 'pmc-section-head' });
		head.createSpan({ cls: 'pmc-section-title', text: 'Hierarchy' });
		const hint = head.createSpan({ cls: 'pmc-hint', text: 'click to zoom' });
		hint.title = 'Rows mirror which group contains which node.';

		const controls = head.createDiv({ cls: 'pmc-section-controls' });
		const toggleAll = controls.createEl('button', { cls: 'pmc-icon-btn', text: '⊟' });
		toggleAll.title = 'Collapse all groups';
		toggleAll.addEventListener('click', () => this.toggleAllGroups(toggleAll));
		const refresh = controls.createEl('button', { cls: 'pmc-icon-btn', text: '↻' });
		refresh.title = 'Re-read the canvas';
		refresh.addEventListener('click', () => this.rebuild());

		this.hierarchyEl = root.createDiv({ cls: 'pmc-hierarchy' });
		this.footerEl = root.createDiv({ cls: 'pmc-footer' });

		this.refreshInfoLine();
		this.renderHierarchy();
	}

	private toggleAllGroups(btn: HTMLButtonElement): void {
		const groupIds = collectGroupIds(this.tree);
		const collapse = groupIds.some(id => !this.collapsedGroups.has(id));
		this.collapsedGroups = collapse ? new Set(groupIds) : new Set();
		btn.setText(collapse ? '⊞' : '⊟');
		btn.title = collapse ? 'Expand all groups' : 'Collapse all groups';
		this.renderHierarchy();
	}

	private refreshInfoLine(): void {
		if (!this.infoLineEl) return;
		this.infoLineEl.empty();
		const canvas = this.canvas();
		if (!canvas) {
			this.infoLineEl.setText('No canvas open');
			return;
		}
		const nodes = this.items.nodes();
		const tasks = this.items.totals();
		const selected = canvas.selection?.size ?? 0;
		const parts = [
			`${nodes.length} node${nodes.length === 1 ? '' : 's'}`,
			`${countWords(nodes).toLocaleString()} words`,
		];
		if (tasks.total > 0) parts.push(`${tasks.open}/${tasks.total} open`);
		if (selected > 0) parts.push(`${selected} selected`);
		this.infoLineEl.setText(parts.join(' · '));
	}

	private renderFooter(): void {
		if (!this.footerEl) return;
		this.footerEl.empty();
		if (!filterActive(this.filter)) return;
		const matched = this.items.nodes().filter(n => this.items.matches(n.id, this.filter)).length;
		this.footerEl.createSpan({ cls: 'pmc-hint', text: `${matched} matching` });
		this.footerEl.createEl('button', { text: 'Clear filter' })
			.addEventListener('click', () => this.clearFilter());
	}

	private clearFilter(): void {
		this.filter = emptyFilter();
		this.taskMode = 'any';
		this.buildTaskButtons();
		this.updateFilterBtn();
		this.closeDropdown();
		const find = this.toolbarEl?.querySelector<HTMLInputElement>('.pmc-tb-find');
		if (find) find.value = '';
		this.applyFilters();
	}

	// ───── hierarchy ─────

	private renderHierarchy(): void {
		if (!this.hierarchyEl) return;
		const scroll = this.hierarchyEl.scrollTop;
		this.hierarchyEl.empty();

		if (!this.canvas()) {
			this.hierarchyEl.createDiv({ cls: 'pmc-hint', text: 'Open a canvas to see its items.' });
			this.renderFooter();
			return;
		}
		if (this.tree.length === 0) {
			this.hierarchyEl.createDiv({ cls: 'pmc-hint', text: 'This canvas has no nodes.' });
			this.renderFooter();
			return;
		}

		this.renderTreeNodes(this.tree, this.hierarchyEl);
		this.hierarchyEl.scrollTop = scroll;
		this.syncHierarchyDimming();
		this.renderFooter();
	}

	private renderTreeNodes(branch: CanvasTreeNode[], container: HTMLElement): void {
		for (const t of branch) {
			const { node, children } = t;
			const isGroup = node.type === 'group';
			const wrap = isGroup ? container.createDiv({ cls: 'pmc-tree-group-wrap' }) : container;
			const row = wrap.createDiv({ cls: `pmc-tree-node${isGroup ? ' pmc-tree-group' : ''}` });
			row.dataset['nodeId'] = node.id;

			if (isGroup && children.length > 0) {
				const collapsed = this.collapsedGroups.has(node.id);
				const chevron = row.createEl('button', { cls: 'pmc-tree-chevron', text: collapsed ? '▶' : '▼' });
				chevron.addEventListener('click', e => {
					e.stopPropagation();
					if (this.collapsedGroups.has(node.id)) this.collapsedGroups.delete(node.id);
					else this.collapsedGroups.add(node.id);
					this.renderHierarchy();
				});
			} else {
				row.createSpan({ cls: 'pmc-tree-chevron-gap' });
			}

			row.createSpan({ cls: node.color ? `pmc-node-dot pmc-dot-${node.color}` : 'pmc-node-dot' });
			row.createSpan({
				cls: `pmc-tree-label${isGroup ? ' pmc-tree-group-label' : ''}`,
				text: getNodeDisplayName(node),
			});

			if (isGroup) row.createSpan({ cls: 'pmc-tree-count', text: String(countDescendants(t)) });
			this.renderTaskPip(row, isGroup ? this.items.subtreeCounts(node.id) : this.items.counts(node.id));

			row.title = 'Click to zoom';
			row.addEventListener('click', () => this.zoomTo(node.id));

			if (children.length > 0) {
				if (isGroup) {
					const childrenEl = wrap.createDiv({ cls: 'pmc-tree-children' });
					if (this.collapsedGroups.has(node.id)) childrenEl.addClass('pmc-tree-collapsed');
					this.renderTreeNodes(children, childrenEl);
				} else {
					this.renderTreeNodes(children, container);
				}
			}
		}
	}

	/** Open / done pip, driven by parsed items rather than a checkbox regex. */
	private renderTaskPip(row: HTMLElement, counts: TaskCounts): void {
		if (counts.total === 0) return;
		const open = counts.open > 0;
		const pip = row.createSpan({ cls: `pmc-task-pip ${open ? 'pmc-task-open' : 'pmc-task-done'}` });
		pip.setText(open ? `${counts.open}` : '✓');
		pip.title = open
			? `${counts.open} open of ${counts.total} task${counts.total === 1 ? '' : 's'}`
			: `All ${counts.total} task${counts.total === 1 ? '' : 's'} closed`;
	}

	private zoomTo(id: string): void {
		const canvas = this.canvas();
		if (!canvas) return;
		const live = getCanvasData(canvas).nodes.find(n => n.id === id);
		if (live) zoomToNode(canvas, live);
	}

	// ═══ Toolbar ══════════════════════════════════════════════════════════════

	private buildToolbar(toolbar: HTMLElement): void {
		const filterWrap = toolbar.createDiv({ cls: 'pmc-tb-filter-wrap' });
		this.filterBtnEl = filterWrap.createEl('button', { cls: 'pmc-tb-btn pmc-tb-filter-btn' });
		this.updateFilterBtn();
		this.filterBtnEl.addEventListener('click', e => { e.stopPropagation(); this.toggleDropdown(); });

		toolbar.createSpan({ cls: 'pmc-tb-sep' });

		this.taskWrapEl = toolbar.createDiv({ cls: 'pmc-tb-task-wrap' });
		this.buildTaskButtons();

		toolbar.createSpan({ cls: 'pmc-tb-sep' });

		const find = toolbar.createEl('input', { cls: 'pmc-tb-find', type: 'text' });
		find.placeholder = 'Find…';
		find.value = this.filter.query;
		find.addEventListener('input', () => {
			this.filter.query = find.value;
			window.clearTimeout(this.searchDebounce);
			this.searchDebounce = window.setTimeout(() => this.applyFilters(), 180);
		});

		toolbar.createSpan({ cls: 'pmc-tb-sep' });

		const auto = toolbar.createEl('button', { cls: 'pmc-tb-btn pmc-tb-auto-btn', text: '⬡' });
		auto.title = 'Auto-size matching nodes';
		auto.addEventListener('click', () => this.autoSize());
	}

	private autoDimId(): string | null {
		return this.store.getConfig().dimensions.find(d => d.kind === 'auto')?.id ?? null;
	}

	private buildTaskButtons(): void {
		if (!this.taskWrapEl) return;
		this.taskWrapEl.empty();
		const dimId = this.autoDimId();
		if (!dimId) return;   // no Type dimension configured — nothing to filter on

		const totals = this.items.totals();
		const modes: { mode: TaskMode; label: string; count: number | null }[] = [
			{ mode: 'any', label: 'Any', count: null },
			{ mode: 'open', label: 'Open', count: totals.open },
			{ mode: 'done', label: 'Done', count: totals.done },
		];

		for (const { mode, label, count } of modes) {
			const btn = this.taskWrapEl.createEl('button', {
				cls: `pmc-tb-btn pmc-tb-task-btn${mode === this.taskMode ? ' pmc-tb-active' : ''}`,
			});
			btn.createSpan({ text: label });
			if (count !== null) btn.createSpan({ cls: 'pmc-tb-count', text: String(count) });
			btn.addEventListener('click', () => this.setTaskMode(mode));
		}
	}

	private setTaskMode(mode: TaskMode): void {
		const dimId = this.autoDimId();
		if (!dimId) return;
		this.taskMode = mode;
		const values = TASK_MODE_VALUES[mode];
		if (values.length === 0) this.filter.dims.delete(dimId);
		else this.filter.dims.set(dimId, new Set(values));
		this.buildTaskButtons();
		this.updateFilterBtn();
		this.applyFilters();
	}

	private updateFilterBtn(): void {
		if (!this.filterBtnEl) return;
		const dimId = this.autoDimId();
		// The task buttons own the Type dimension; don't count it twice.
		let n = this.filter.tags.size;
		for (const [id, values] of this.filter.dims) {
			if (id !== dimId) n += values.size;
		}
		this.filterBtnEl.setText(n > 0 ? `Filter (${n})` : 'Filter');
		this.filterBtnEl.toggleClass('pmc-tb-active', n > 0);
	}

	private toggleDropdown(): void {
		if (this.dropdownEl) { this.closeDropdown(); return; }
		if (!this.toolbarEl) return;

		const dropdown = this.toolbarEl.createDiv({ cls: 'pmc-tb-dropdown' });
		this.dropdownEl = dropdown;

		const { dims, tags } = this.items.presentValues();
		const configured = this.store.getConfig().dimensions;
		let rendered = false;

		for (const dim of configured) {
			const values = dims.get(dim.id);
			if (!values || values.size === 0) continue;
			rendered = true;
			dropdown.createDiv({ cls: 'pmc-dropdown-label', text: dim.name });
			const row = dropdown.createDiv({ cls: 'pmc-chip-row' });
			const sorted = [...values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
			for (const [value, count] of sorted) {
				this.renderChip(row, value, count, () => this.toggleDimValue(dim.id, value));
			}
		}

		if (tags.size > 0) {
			rendered = true;
			dropdown.createDiv({ cls: 'pmc-dropdown-label', text: 'Tags' });
			const row = dropdown.createDiv({ cls: 'pmc-chip-row' });
			const sorted = [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
			for (const [tag, count] of sorted) {
				this.renderChip(row, `#${tag}`, count, () => this.toggleTag(tag), this.filter.tags.has(tag));
			}
		}

		if (!rendered) dropdown.createDiv({ cls: 'pmc-hint', text: 'No topics or tags on this canvas.' });

		// Close when the click lands outside the toolbar.
		this.outsideClick = (e: MouseEvent) => {
			if (this.toolbarEl && !this.toolbarEl.contains(e.target as Node)) this.closeDropdown();
		};
		window.setTimeout(() => {
			if (this.outsideClick) document.addEventListener('mousedown', this.outsideClick);
		}, 0);
	}

	private renderChip(row: HTMLElement, label: string, count: number, onClick: () => void, active?: boolean): void {
		const isActive = active ?? this.chipActive(label);
		const chip = row.createSpan({ cls: `pmc-chip${isActive ? ' pmc-chip-active' : ''}` });
		chip.createSpan({ cls: 'pmc-chip-name', text: label });
		chip.createSpan({ cls: 'pmc-chip-count', text: String(count) });
		chip.addEventListener('click', e => { e.stopPropagation(); onClick(); });
	}

	private chipActive(value: string): boolean {
		for (const values of this.filter.dims.values()) if (values.has(value)) return true;
		return false;
	}

	private toggleDimValue(dimId: string, value: string): void {
		const set = this.filter.dims.get(dimId) ?? new Set<string>();
		if (set.has(value)) set.delete(value); else set.add(value);
		if (set.size === 0) this.filter.dims.delete(dimId); else this.filter.dims.set(dimId, set);
		this.refreshDropdown();
	}

	private toggleTag(tag: string): void {
		if (this.filter.tags.has(tag)) this.filter.tags.delete(tag);
		else this.filter.tags.add(tag);
		this.refreshDropdown();
	}

	private refreshDropdown(): void {
		this.updateFilterBtn();
		this.applyFilters();
		// Re-open so chip states and the outside-click handler stay consistent.
		this.closeDropdown();
		this.toggleDropdown();
	}

	private closeDropdown(): void {
		if (this.outsideClick) {
			document.removeEventListener('mousedown', this.outsideClick);
			this.outsideClick = null;
		}
		this.dropdownEl?.remove();
		this.dropdownEl = null;
	}

	private autoSize(): void {
		const canvas = this.canvas();
		if (!canvas) { new Notice('Open a canvas first.'); return; }
		const active = filterActive(this.filter)
			? this.items.nodes().filter(n => this.items.matches(n.id, this.filter))
			: this.items.nodes();
		const target = active.filter((n: CanvasNodeData) => n.type !== 'group');
		if (target.length === 0) { new Notice('No matching nodes to resize.'); return; }
		const n = autoResizeNodes(canvas, target);
		new Notice(`Auto-sized ${n} node${n === 1 ? '' : 's'}.`);
	}

	// ═══ Filtering ════════════════════════════════════════════════════════════

	private applyFilters(): void {
		const canvas = this.canvas();
		if (!canvas) return;
		const active = filterActive(this.filter);

		for (const node of this.items.nodes()) {
			const el = canvas.nodes.get(node.id)?.nodeEl;
			if (!el) continue;
			const ok = !active || this.items.matches(node.id, this.filter);
			el.toggleClass('pmc-node-dimmed', active && !ok);
			el.toggleClass('pmc-node-active', active && ok);
		}

		this.syncHierarchyDimming();
		this.renderFooter();
	}

	/** Mirror canvas dimming onto the hierarchy rows. */
	private syncHierarchyDimming(): void {
		if (!this.hierarchyEl) return;
		const active = filterActive(this.filter);
		for (const row of Array.from(this.hierarchyEl.querySelectorAll<HTMLElement>('.pmc-tree-node'))) {
			const id = row.dataset['nodeId'];
			const dimmed = active && !!id && !this.items.matches(id, this.filter);
			row.toggleClass('pmc-tree-dimmed', dimmed);
		}
	}
}

function collectGroupIds(branch: CanvasTreeNode[]): string[] {
	const out: string[] = [];
	for (const t of branch) {
		if (t.node.type === 'group' && t.children.length > 0) out.push(t.node.id);
		out.push(...collectGroupIds(t.children));
	}
	return out;
}
