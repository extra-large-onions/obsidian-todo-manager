import { App, MarkdownView, Modal, TFile } from 'obsidian';
import { IndexStore } from '../index-store';
import { Item } from '../types';

/** Lists items missing tags or time metadata, with click-to-reveal. */
export class SyncModal extends Modal {
	constructor(app: App, private store: IndexStore) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('pm-sync');
		contentEl.createEl('h2', { text: 'Sync — items needing attention' });

		const untagged = this.store.untagged();
		const untimed = this.store.untimed();

		this.section('Untagged', untagged);
		this.section('Untimed', untimed);

		if (untagged.length === 0 && untimed.length === 0) {
			contentEl.createDiv({ cls: 'pm-sync-empty', text: 'Everything is tagged and timed. ✓' });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private section(title: string, items: Item[]): void {
		const sec = this.contentEl.createDiv({ cls: 'pm-sync-section' });
		sec.createEl('h3', { text: `${title} (${items.length})` });
		if (items.length === 0) {
			sec.createDiv({ cls: 'pm-sync-empty', text: 'None.' });
			return;
		}
		const list = sec.createEl('ul', { cls: 'pm-sync-list' });
		for (const it of items) {
			const li = list.createEl('li');
			li.createSpan({ cls: 'pm-sync-text', text: it.text || it.rawText });
			li.createSpan({ cls: 'pm-sync-loc', text: ` ${it.loc.path}:${it.loc.line + 1}` });
			const btn = li.createEl('button', { cls: 'pm-sync-reveal', text: 'Reveal' });
			btn.addEventListener('click', () => void this.reveal(it));
		}
	}

	private async reveal(item: Item): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(item.loc.path);
		if (!(file instanceof TFile)) return;
		this.close();
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			view.editor.setCursor({ line: item.loc.line, ch: 0 });
			view.editor.scrollIntoView({ from: { line: item.loc.line, ch: 0 }, to: { line: item.loc.line, ch: 0 } }, true);
		}
	}
}
