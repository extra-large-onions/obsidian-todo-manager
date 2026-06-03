import { App, Modal, Notice } from 'obsidian';
import ProjectItemsPlugin from '../main';
import { Dimension } from '../types';

const PROTECTED_IDS = new Set(['tree', 'type', 'added', 'due']);

const KIND_OPTIONS: Array<{ value: Dimension['kind']; label: string; desc: string }> = [
	{ value: 'tree',     label: 'Tree',     desc: 'Hierarchical /tag (e.g. polish/asset/sound)'    },
	{ value: 'radio',    label: 'Radio',    desc: 'Flat enum, single value from a fixed list'      },
	{ value: 'checkbox', label: 'Checkbox', desc: 'Flat enum, multiple values from a fixed list'   },
	{ value: 'time',     label: 'Time',     desc: 'Metadata key for dates (e.g. added:2026-05-14)' },
	{ value: 'text',     label: 'Text',     desc: 'Free-string metadata, display only'             },
];

function valuesApply(kind: Dimension['kind']): boolean {
	return kind === 'tree' || kind === 'radio' || kind === 'checkbox';
}

export class TagManagerModal extends Modal {
	private editingId: string | null = null;
	private showAddForm = false;

	constructor(app: App, private plugin: ProjectItemsPlugin) {
		super(app);
		this.modalEl.style.width = '560px';
	}

	onOpen(): void { this.render(); }
	onClose(): void { this.contentEl.empty(); }

	private get dims(): Dimension[] { return this.plugin.settings.dimensions; }

	private async save(): Promise<void> {
		await this.plugin.persist();
		this.render();
	}

	private render(): void {
		const el = this.contentEl;
		el.empty();
		el.addClass('pm-dim-manager');
		el.createEl('h2', { text: 'Dimension manager' });

		const protected_ = this.dims.filter(d => PROTECTED_IDS.has(d.id));
		const custom     = this.dims.filter(d => !PROTECTED_IDS.has(d.id));

		el.createEl('h3', { text: 'Default dimensions' });
		for (const dim of protected_) this.renderRow(el, dim, true);

		if (custom.length > 0) {
			el.createEl('h3', { text: 'Custom dimensions' });
			for (const dim of custom) this.renderRow(el, dim, false);
		}

		if (this.showAddForm) {
			this.renderAddForm(el);
		} else {
			const footer = el.createDiv({ cls: 'pm-dm-footer' });
			footer.createEl('button', { text: '+ Add dimension', cls: 'mod-cta' })
				.addEventListener('click', () => { this.showAddForm = true; this.editingId = null; this.render(); });
		}
	}

	// ---------- row ----------

	private renderRow(parent: HTMLElement, dim: Dimension, isProtected: boolean): void {
		if (this.editingId === dim.id) {
			this.renderEditForm(parent, dim, isProtected);
			return;
		}
		const row = parent.createDiv({ cls: 'pm-dm-row' });
		row.createEl('code',  { text: dim.id,   cls: 'pm-dm-id'   });
		row.createSpan({ text: dim.name, cls: 'pm-dm-name' });
		row.createSpan({ text: dim.kind, cls: 'pm-dm-kind'  });
		if (dim.values.length > 0) {
			row.createSpan({ text: dim.values.join(', '), cls: 'pm-dm-values' });
		} else if (valuesApply(dim.kind)) {
			row.createSpan({ text: dim.kind === 'tree' ? '(auto)' : '(empty)', cls: 'pm-dm-values pm-dm-values-empty' });
		}

		const actions = row.createDiv({ cls: 'pm-dm-actions' });
		actions.createEl('button', { text: 'Edit' })
			.addEventListener('click', () => { this.editingId = dim.id; this.showAddForm = false; this.render(); });
		if (!isProtected) {
			actions.createEl('button', { text: 'Delete', cls: 'pm-dm-delete' })
				.addEventListener('click', () => void this.deleteDim(dim));
		}
	}

	// ---------- edit form ----------

	private renderEditForm(parent: HTMLElement, dim: Dimension, isProtected: boolean): void {
		const form = parent.createDiv({ cls: 'pm-dm-form' });
		form.createDiv({ cls: 'pm-dm-form-id', text: dim.id });

		const nameInput    = this.formRow(form, 'Name', 'input',  { type: 'text', value: dim.name }) as HTMLInputElement;
		let kindSelect: HTMLSelectElement | null = null;
		let valuesArea: HTMLTextAreaElement | null = null;

		// Kind
		const kindWrap = form.createDiv({ cls: 'pm-dm-form-row' });
		kindWrap.createEl('label', { text: 'Kind' });
		if (isProtected) {
			kindWrap.createSpan({ text: dim.kind, cls: 'pm-dm-kind pm-dm-kind-label' });
		} else {
			kindSelect = kindWrap.createEl('select');
			for (const o of KIND_OPTIONS) {
				const opt = kindSelect.createEl('option', { value: o.value, text: o.label });
				if (dim.kind === o.value) opt.selected = true;
			}
		}

		// Values
		const currentKind = (): Dimension['kind'] => (kindSelect?.value ?? dim.kind) as Dimension['kind'];
		const valWrap = form.createDiv({ cls: 'pm-dm-form-row' });
		valWrap.createEl('label', { text: 'Values' });
		valuesArea = valWrap.createEl('textarea', { cls: 'pm-dm-values-input' });
		valuesArea.rows = 4;
		valuesArea.value = dim.values.join('\n');
		valWrap.createDiv({ cls: 'pm-dm-hint', text: 'One value per line. Tree: leave empty for auto-discovery.' });
		const updateValVisibility = () => { valWrap.style.display = valuesApply(currentKind()) ? '' : 'none'; };
		updateValVisibility();
		kindSelect?.addEventListener('change', updateValVisibility);

		const btns = form.createDiv({ cls: 'pm-dm-form-btns' });
		btns.createEl('button', { text: 'Save', cls: 'mod-cta' }).addEventListener('click', () => {
			const newName = nameInput.value.trim();
			if (!newName) { new Notice('Name cannot be empty.'); return; }
			const newKind   = currentKind();
			const newValues = valuesApply(newKind)
				? valuesArea!.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
				: [];
			const idx = this.dims.findIndex(d => d.id === dim.id);
			if (idx !== -1) this.plugin.settings.dimensions[idx] = { id: dim.id, name: newName, kind: newKind, values: newValues };
			this.editingId = null;
			void this.save();
		});
		btns.createEl('button', { text: 'Cancel' }).addEventListener('click', () => { this.editingId = null; this.render(); });
	}

	// ---------- add form ----------

	private renderAddForm(parent: HTMLElement): void {
		const form = parent.createDiv({ cls: 'pm-dm-form pm-dm-form-add' });
		form.createEl('h3', { text: 'New dimension' });

		const idInput   = this.formRow(form, 'Id',   'input', { type: 'text', placeholder: 'priority' }) as HTMLInputElement;
		const nameInput = this.formRow(form, 'Name', 'input', { type: 'text', placeholder: 'Priority'  }) as HTMLInputElement;

		const kindWrap = form.createDiv({ cls: 'pm-dm-form-row' });
		kindWrap.createEl('label', { text: 'Kind' });
		const kindSelect = kindWrap.createEl('select');
		for (const o of KIND_OPTIONS) {
			const opt = kindSelect.createEl('option', { value: o.value, text: o.label });
			kindSelect.createEl('option'); // placeholder; overwrite below
			opt.title = o.desc;
		}
		kindSelect.innerHTML = ''; // reset
		for (const o of KIND_OPTIONS) {
			kindSelect.createEl('option', { value: o.value, text: `${o.label} — ${o.desc}` });
		}
		kindSelect.value = 'radio';

		const valWrap = form.createDiv({ cls: 'pm-dm-form-row' });
		valWrap.createEl('label', { text: 'Values' });
		const valuesArea = valWrap.createEl('textarea', { cls: 'pm-dm-values-input' });
		valuesArea.rows = 4;
		valuesArea.placeholder = 'high\nmedium\nlow';
		valWrap.createDiv({ cls: 'pm-dm-hint', text: 'One value per line. Tree: leave empty for auto-discovery.' });

		const updateValVisibility = () => {
			valWrap.style.display = valuesApply(kindSelect.value as Dimension['kind']) ? '' : 'none';
		};
		updateValVisibility();
		kindSelect.addEventListener('change', updateValVisibility);

		const btns = form.createDiv({ cls: 'pm-dm-form-btns' });
		btns.createEl('button', { text: 'Add', cls: 'mod-cta' }).addEventListener('click', () => {
			const id   = idInput.value.trim().toLowerCase().replace(/\s+/g, '-');
			const name = nameInput.value.trim();
			const kind = kindSelect.value as Dimension['kind'];
			if (!id)   { new Notice('Id is required.'); return; }
			if (!name) { new Notice('Name is required.'); return; }
			if (this.dims.some(d => d.id === id)) { new Notice(`Dimension id "${id}" already exists.`); return; }
			const values = valuesApply(kind)
				? valuesArea.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
				: [];
			this.plugin.settings.dimensions.push({ id, name, kind, values });
			this.showAddForm = false;
			void this.save();
		});
		btns.createEl('button', { text: 'Cancel' }).addEventListener('click', () => { this.showAddForm = false; this.render(); });
	}

	// ---------- delete ----------

	private async deleteDim(dim: Dimension): Promise<void> {
		if (!window.confirm(`Delete dimension "${dim.name}"?\n\nThis only removes it from config — tags in your notes are not changed.`)) return;
		this.plugin.settings.dimensions = this.plugin.settings.dimensions.filter(d => d.id !== dim.id);
		if (this.plugin.settings.treeDimId === dim.id) {
			const fallback = this.plugin.settings.dimensions.find(d => d.kind === 'tree');
			this.plugin.settings.treeDimId = fallback?.id ?? 'tree';
		}
		await this.save();
	}

	// ---------- helper ----------

	private formRow(parent: HTMLElement, label: string, tag: string, attrs: Record<string, string>): HTMLElement {
		const wrap = parent.createDiv({ cls: 'pm-dm-form-row' });
		wrap.createEl('label', { text: label });
		return wrap.createEl(tag as keyof HTMLElementTagNameMap, { attr: attrs }) as HTMLElement;
	}
}
