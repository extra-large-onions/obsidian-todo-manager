import { Plugin, WorkspaceLeaf } from 'obsidian';
import { IndexStore } from './index-store';
import { DEFAULT_SETTINGS, PMSettings, PMSettingTab } from './settings';
import { TagSuggest } from './suggester/tag-suggest';
import { CentralView, VIEW_TYPE_PM_CENTRAL } from './views/central-view';
import { TagManagerModal } from './views/tag-manager';

export default class ProjectItemsPlugin extends Plugin {
	settings: PMSettings;
	store: IndexStore;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new IndexStore(this, {
			dimensions: this.settings.dimensions,
			treeDimId: this.settings.treeDimId,
			debounceMs: this.settings.debounceMs,
			rootFolder: this.settings.rootFolder,
		});

		this.registerView(VIEW_TYPE_PM_CENTRAL, (leaf: WorkspaceLeaf) => new CentralView(leaf, this.store));
		this.registerEditorSuggest(new TagSuggest(this.app, this.store));

		this.addRibbonIcon('list-checks', 'Project items', () => void this.activateView());

		this.addCommand({
			id: 'open-central',
			name: 'Open central view',
			callback: () => void this.activateView(),
		});
		this.addCommand({
			id: 'open-tag-manager',
			name: 'Open dimension manager',
			callback: () => new TagManagerModal(this.app, this).open(),
		});

		this.addSettingTab(new PMSettingTab(this.app, this));

		// Defer initial scan until layout is ready so it doesn't block startup.
		this.app.workspace.onLayoutReady(() => void this.store.start());
	}

	onunload(): void {
		// register* helpers handle teardown.
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<PMSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
	}

	async persist(): Promise<void> {
		await this.saveData(this.settings);
		this.store?.updateConfig({
			dimensions: this.settings.dimensions,
			treeDimId: this.settings.treeDimId,
			debounceMs: this.settings.debounceMs,
			rootFolder: this.settings.rootFolder,
		});
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_PM_CENTRAL);
		if (existing.length > 0) {
			await workspace.revealLeaf(existing[0]!);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_PM_CENTRAL, active: true });
		await workspace.revealLeaf(leaf);
	}
}
