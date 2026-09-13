import { ItemView, Notice, Setting, WorkspaceLeaf, debounce } from 'obsidian';
import { KIND_ALIASES, parseDimensionsText, serializeDimensions } from '../dimensions-format';
import { IndexStore } from '../index-store';
import { DimUse, Inventory, ValueUse, buildInventory } from '../inventory';
import type ProjectItemsPlugin from '../main';
import { PMSettings } from '../settings';

export const VIEW_TYPE_PM_MANAGE = 'pm-manage-view';

/** How many values a dimension shows before it needs expanding. */
const VALUE_PREVIEW = 12;

const KIND_BLURB: Record<string, string> = {
	tree: 'nested topics; leave empty to take them from your headings',
	radio: 'one value per item',
	checkbox: 'any number of values per item',
	time: 'a date, written as %% id:2026-05-14 %%',
	text: 'free text, written as %% id:value %%',
	auto: 'derived from the item itself; not something you tag',
};

export class ManageView extends ItemView {
	private draft = '';
	private editor: HTMLTextAreaElement | null = null;
	private errorsEl: HTMLElement | null = null;
	private dirtyEl: HTMLElement | null = null;
	private scopeEl: HTMLElement | null = null;
	private invEl: HTMLElement | null = null;
	private expanded = new Set<string>();
	private refreshInventory: () => void;

	constructor(leaf: WorkspaceLeaf, private store: IndexStore, private plugin: ProjectItemsPlugin) {
		super(leaf);
		this.refreshInventory = debounce(() => this.renderInventory(), 120, true);
	}

	getViewType(): string { return VIEW_TYPE_PM_MANAGE; }
	getDisplayText(): string { return 'Project items: manage'; }
	getIcon(): string { return 'sliders-horizontal'; }

	async onOpen(): Promise<void> {
		this.draft = serializeDimensions(this.store.getConfig().dimensions);
		this.renderShell();
		this.registerEvent(this.store.on('changed', () => {
			// An external change (or our own save) re-scanned the vault: refresh the
			// numbers, and re-sync the editor only when there's nothing to lose.
			if (!this.isDirty()) this.resyncDraft();
			this.refreshInventory();
		}));
	}

	async onClose(): Promise<void> { /* nothing */ }

	// ===== shell =====

	private renderShell(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('pmm-root');

		const header = root.createDiv({ cls: 'pmm-header' });
		header.createDiv({ cls: 'pmm-title', text: 'Dimensions' });
		this.dirtyEl = header.createDiv({ cls: 'pmm-dirty', text: 'unsaved changes' });
		this.dirtyEl.hidden = true;

		const btns = header.createDiv({ cls: 'pmm-header-btns' });
		btns.createEl('button', { text: 'Save', cls: 'mod-cta' })
			.addEventListener('click', () => void this.save());
		btns.createEl('button', { text: 'Revert' })
			.addEventListener('click', () => { this.resyncDraft(); this.showErrors([]); });
		btns.createEl('button', { text: 'Copy as Markdown' })
			.addEventListener('click', () => {
				void navigator.clipboard.writeText(this.draft)
					.then(() => new Notice('Dimensions copied'));
			});

		const body = root.createDiv({ cls: 'pmm-body' });
		this.renderEditorColumn(body.createDiv({ cls: 'pmm-col pmm-col-edit' }));
		this.invEl = body.createDiv({ cls: 'pmm-col pmm-col-inv' });
		this.renderInventory();
	}

	private renderEditorColumn(col: HTMLElement): void {
		this.renderSyntaxHelp(col);

		this.errorsEl = col.createDiv({ cls: 'pmm-errors' });
		this.errorsEl.hidden = true;

		const ta = col.createEl('textarea', { cls: 'pmm-editor' });
		ta.spellcheck = false;
		ta.value = this.draft;
		ta.addEventListener('input', () => { this.draft = ta.value; this.markDirty(); });
		this.registerDomEvent(ta, 'keydown', evt => {
			if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 's') {
				evt.preventDefault();
				void this.save();
			}
		});
		this.editor = ta;

		this.scopeEl = col.createDiv({ cls: 'pmm-scope' });
		this.renderScope();
	}

	private renderSyntaxHelp(col: HTMLElement): void {
		const det = col.createEl('details', { cls: 'pmm-syntax' });
		det.createEl('summary', { text: 'Format' });
		const p = det.createDiv({ cls: 'pmm-syntax-body' });

		p.createEl('p', { text: 'One dimension per line, or per heading when it has many or nested values:' });
		p.createEl('pre', {
			cls: 'pmm-sample',
			text: [
				'Priority: enum[high, medium, low]',
				'Due: date',
				'',
				'Topic: tree',
				'- Deployment',
				'  - Startup          -> Deployment/Startup',
				'',
				'## Area  {checkbox}  (id: area)',
				'- backend',
				'- ui',
			].join('\n'),
		});

		const kinds = p.createEl('ul', { cls: 'pmm-kinds' });
		for (const [kind, aliases] of Object.entries(KIND_ALIASES)) {
			const li = kinds.createEl('li');
			li.createSpan({ cls: 'pmm-kind-name', text: kind });
			const alt = aliases.slice(1);
			if (alt.length > 0) li.createSpan({ cls: 'pmm-kind-alias', text: ` (or ${alt.join(', ')})` });
			li.createSpan({ text: ` — ${KIND_BLURB[kind] ?? ''}` });
		}

		p.createEl('p', {
			cls: 'pmm-syntax-note',
			text: 'The id is slugged from the name and is the key used in your notes (%% due:2026-06-01 %%); write "(id: x)" before the colon to pin it so a rename stays compatible. Blank lines, // comments, <!-- comments --> and plain headings are ignored.',
		});
	}

	// ===== index scope (moved out of the settings tab) =====

	private renderScope(): void {
		const el = this.scopeEl;
		if (!el) return;
		el.empty();
		el.createDiv({ cls: 'pmm-section-label', text: 'Index scope' });

		new Setting(el)
			.setName('Tree dimension')
			.setDesc('Which dimension is the topic hierarchy the views group by.')
			.addDropdown(dd => {
				for (const d of this.plugin.settings.dimensions) {
					if (d.kind === 'tree') dd.addOption(d.id, d.name);
				}
				dd.setValue(this.plugin.settings.treeDimId);
				dd.onChange(async v => {
					this.plugin.settings.treeDimId = v;
					await this.plugin.persist();
				});
			});

		new Setting(el)
			.setName('Root folder')
			.setDesc('Scan only this folder and its subfolders. Leave blank to scan the whole vault.')
			.addText(t => {
				t.setPlaceholder('Projects/work').setValue(this.plugin.settings.rootFolder);
				t.onChange(debounce(async (v: string) => {
					this.plugin.settings.rootFolder = v.trim().replace(/\/$/, '');
					await this.plugin.persist();
				}, 500, false));
			});

		new Setting(el)
			.setName('Which files count')
			.setDesc('All Markdown files, or only files that opt in (named *.todo.md, or with the frontmatter key below).')
			.addDropdown(dd => {
				dd.addOption('all', 'All Markdown files');
				dd.addOption('opt-in', 'Opt-in files only');
				dd.setValue(this.plugin.settings.scopeMode);
				dd.onChange(async v => {
					this.plugin.settings.scopeMode = v as PMSettings['scopeMode'];
					await this.plugin.persist();
				});
			});

		new Setting(el)
			.setName('Opt-in frontmatter key')
			.setDesc('In opt-in mode a file is scanned if this frontmatter key is truthy (e.g. "todos: true"), or its name ends with .todo.md.')
			.addText(t => {
				t.setPlaceholder('todos').setValue(this.plugin.settings.optInProperty);
				t.onChange(debounce(async (v: string) => {
					this.plugin.settings.optInProperty = v.trim() || 'todos';
					await this.plugin.persist();
				}, 500, false));
			});
	}

	// ===== inventory =====

	private renderInventory(): void {
		const el = this.invEl;
		if (!el) return;
		const scroll = el.scrollTop;
		el.empty();

		const inv = buildInventory(this.store);
		this.renderStats(el, inv);

		el.createDiv({ cls: 'pmm-section-label', text: 'In your vault' });
		for (const use of inv.dims) this.renderDimCard(el, use);

		this.renderFreeTags(el, inv);
		this.renderUnknownMeta(el, inv);

		el.scrollTop = scroll;
	}

	private renderStats(el: HTMLElement, inv: Inventory): void {
		const stats = el.createDiv({ cls: 'pmm-stats' });
		const add = (label: string, value: string) => {
			const s = stats.createDiv({ cls: 'pmm-stat' });
			s.createDiv({ cls: 'pmm-stat-value', text: value });
			s.createDiv({ cls: 'pmm-stat-label', text: label });
		};
		const tasks = [...inv.byStatus.values()].reduce((a, b) => a + b, 0);
		add('files', String(inv.files));
		add('items', String(inv.items));
		add('tasks', String(tasks));
		add('open', String((inv.byStatus.get('todo') ?? 0) + (inv.byStatus.get('doing') ?? 0)));
		add('done', String(inv.byStatus.get('done') ?? 0));
		add('undated', String(inv.undated));
	}

	private renderDimCard(el: HTMLElement, use: DimUse): void {
		const card = el.createDiv({ cls: 'pmm-card' });
		const head = card.createDiv({ cls: 'pmm-card-head' });
		head.createSpan({ cls: 'pmm-card-name', text: use.dim.name });
		head.createSpan({ cls: `pmm-kind-tag pmm-kind-${use.dim.kind}`, text: use.dim.kind });
		head.createSpan({ cls: 'pmm-card-id', text: use.dim.id });
		head.createSpan({ cls: 'pmm-card-count', text: `${use.values.length} value${use.values.length === 1 ? '' : 's'} · ${use.items} item${use.items === 1 ? '' : 's'}` });

		if (use.values.length === 0) {
			card.createDiv({ cls: 'pmm-empty-note', text: 'Nothing in the vault uses this dimension yet.' });
		} else {
			const expanded = this.expanded.has(use.dim.id);
			const shown = expanded ? use.values : use.values.slice(0, VALUE_PREVIEW);
			const list = card.createDiv({ cls: 'pmm-values' });
			for (const v of shown) this.renderValueRow(list, v, use.dim.values.length > 0);
			if (use.values.length > shown.length || expanded) {
				const more = card.createEl('button', {
					cls: 'pmm-more',
					text: expanded ? 'Show less' : `Show all ${use.values.length}`,
				});
				more.addEventListener('click', () => {
					if (expanded) this.expanded.delete(use.dim.id); else this.expanded.add(use.dim.id);
					this.renderInventory();
				});
			}
		}

		if (use.unused.length > 0) {
			const un = card.createDiv({ cls: 'pmm-unused' });
			un.createSpan({ cls: 'pmm-unused-label', text: 'declared but unused: ' });
			un.createSpan({ text: use.unused.join(', ') });
		}
	}

	private renderValueRow(list: HTMLElement, v: ValueUse, dimDeclares: boolean): void {
		const row = list.createDiv({ cls: 'pmm-value' });
		row.createSpan({ cls: 'pmm-value-name', text: v.value });
		if (dimDeclares && !v.declared) {
			row.createSpan({ cls: 'pmm-badge pmm-badge-new', text: 'undeclared' });
		}
		row.createSpan({ cls: 'pmm-value-count', text: `${v.items}` });
		row.setAttribute('aria-label', `${v.items} item${v.items === 1 ? '' : 's'} in ${v.files} file${v.files === 1 ? '' : 's'}`);
	}

	private renderFreeTags(el: HTMLElement, inv: Inventory): void {
		el.createDiv({ cls: 'pmm-section-label', text: 'Tags no dimension claims' });
		const card = el.createDiv({ cls: 'pmm-card' });
		if (inv.freeTags.length === 0) {
			card.createDiv({ cls: 'pmm-empty-note', text: 'Every tag in the vault belongs to a dimension.' });
			return;
		}
		card.createDiv({
			cls: 'pmm-empty-note',
			text: 'These are indexed but ungrouped. Click one to drop it into the dimension you\'re editing.',
		});
		const list = card.createDiv({ cls: 'pmm-values' });
		for (const t of inv.freeTags) {
			const row = list.createDiv({ cls: 'pmm-value pmm-value-click' });
			row.createSpan({ cls: 'pmm-value-name', text: `#${t.value}` });
			row.createSpan({ cls: 'pmm-value-count', text: `${t.items}` });
			row.setAttribute('aria-label', `Insert "${t.value}" into the editor`);
			row.addEventListener('click', () => this.insertValue(t.value));
		}
		const btn = card.createEl('button', { cls: 'pmm-more', text: `Add all ${inv.freeTags.length} as a new dimension` });
		btn.addEventListener('click', () => this.appendDimensionBlock(inv.freeTags.map(t => t.value)));
	}

	private renderUnknownMeta(el: HTMLElement, inv: Inventory): void {
		el.createDiv({ cls: 'pmm-section-label', text: 'Metadata with no dimension' });
		const card = el.createDiv({ cls: 'pmm-card' });
		if (inv.unknownMeta.length === 0) {
			card.createDiv({ cls: 'pmm-empty-note', text: 'Every %% key:value %% in the vault matches a dimension id.' });
			return;
		}
		card.createDiv({
			cls: 'pmm-empty-note',
			text: 'Written in your notes but ignored, because no dimension has that id. Declare one with a matching id to pick it up.',
		});
		const list = card.createDiv({ cls: 'pmm-values' });
		for (const m of inv.unknownMeta) {
			const row = list.createDiv({ cls: 'pmm-value' });
			row.createSpan({ cls: 'pmm-value-name', text: `${m.value}:` });
			row.createSpan({ cls: 'pmm-value-sample', text: (m.samples ?? []).join(', ') });
			row.createSpan({ cls: 'pmm-value-count', text: `${m.items}` });
		}
	}

	// ===== editing =====

	/** Drop a value in as a bullet at the cursor (or at the end). */
	private insertValue(value: string): void {
		const ta = this.editor;
		if (!ta) return;
		const at = ta.selectionStart ?? ta.value.length;
		const before = ta.value.slice(0, at);
		const needsBreak = before !== '' && !before.endsWith('\n');
		const text = `${needsBreak ? '\n' : ''}- ${value}\n`;
		ta.value = before + text + ta.value.slice(ta.selectionEnd ?? at);
		const caret = at + text.length;
		ta.setSelectionRange(caret, caret);
		ta.focus();
		this.draft = ta.value;
		this.markDirty();
	}

	private appendDimensionBlock(values: string[]): void {
		const ta = this.editor;
		if (!ta) return;
		const block = ['', '## Untriaged  {checkbox}', ...values.map(v => `- ${v}`), ''].join('\n');
		ta.value = ta.value.replace(/\s*$/, '\n') + block;
		ta.setSelectionRange(ta.value.length, ta.value.length);
		ta.focus();
		ta.scrollTop = ta.scrollHeight;
		this.draft = ta.value;
		this.markDirty();
	}

	private isDirty(): boolean {
		return this.draft !== serializeDimensions(this.store.getConfig().dimensions);
	}

	private markDirty(): void {
		if (this.dirtyEl) this.dirtyEl.hidden = !this.isDirty();
	}

	private resyncDraft(): void {
		this.draft = serializeDimensions(this.store.getConfig().dimensions);
		if (this.editor) this.editor.value = this.draft;
		this.markDirty();
	}

	private showErrors(msgs: string[]): void {
		const el = this.errorsEl;
		if (!el) return;
		el.empty();
		el.hidden = msgs.length === 0;
		for (const m of msgs) el.createDiv({ text: m });
	}

	private async save(): Promise<void> {
		const { dims, errors } = parseDimensionsText(this.draft);
		if (errors.length > 0) {
			this.showErrors(errors);
			new Notice(`${errors.length} problem${errors.length === 1 ? '' : 's'} in the dimension list — nothing saved.`);
			return;
		}
		this.showErrors([]);
		await this.plugin.setDimensions(dims);   // persists + re-scans; 'changed' refreshes us
		this.resyncDraft();
		this.renderScope();                      // the tree-dimension choices may have changed
		new Notice(`Saved ${dims.length} dimension${dims.length === 1 ? '' : 's'}.`);
	}
}
