import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ConcealConfig, concealExtension } from './editor/conceal';
import { IndexStore } from './index-store';
import { stampMissingDates } from './reconcile';
import { DEFAULT_SETTINGS, PMSettings, PMSettingTab } from './settings';
import { TagSuggest } from './suggester/tag-suggest';
import { Dimension } from './types';
import { CentralView, VIEW_TYPE_PM_CENTRAL } from './views/central-view';

export default class ProjectItemsPlugin extends Plugin {
	settings: PMSettings;
	store: IndexStore;
	// Stable object read live by the conceal editor extension.
	private concealConfig: ConcealConfig = { enabled: true, concealTags: false };
	private reconcileIntervalId: number | null = null;
	private lastActivePath: string | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.store = new IndexStore(this, this.indexConfig());

		this.registerView(VIEW_TYPE_PM_CENTRAL, (leaf: WorkspaceLeaf) => new CentralView(leaf, this.store, this));
		this.registerEditorSuggest(new TagSuggest(this.app, this.store));
		this.syncConcealConfig();
		this.registerEditorExtension(concealExtension(this.concealConfig));

		this.addRibbonIcon('list-checks', 'Project items', () => void this.activateView());

		this.addCommand({
			id: 'open-central',
			name: 'Open central view',
			callback: () => void this.activateView(),
		});

		this.addSettingTab(new PMSettingTab(this.app, this));

		// Auto date-stamp reconciler (opt-in). Stamp the file you just left.
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.onLeafChange()));

		// Defer initial scan until layout is ready so it doesn't block startup.
		this.app.workspace.onLayoutReady(() => {
			this.lastActivePath = this.app.workspace.getActiveFile()?.path ?? null;
			void this.store.start().then(() => {
				if (this.settings.autoStamp) {
					// One quiet sweep shortly after load (skips the active file).
					window.setTimeout(() => void this.runReconcile(), 3000);
				}
			});
			this.scheduleReconcile();
		});
	}

	/** Replace the dimension list (from the in-view editor); persists + re-scans. */
	async setDimensions(dims: Dimension[]): Promise<void> {
		this.settings.dimensions = dims;
		if (!dims.some(d => d.id === this.settings.treeDimId)) {
			this.settings.treeDimId = dims.find(d => d.kind === 'tree')?.id ?? 'tree';
		}
		await this.persist();
	}

	private indexConfig() {
		return {
			dimensions: this.settings.dimensions,
			treeDimId: this.settings.treeDimId,
			debounceMs: this.settings.debounceMs,
			rootFolder: this.settings.rootFolder,
			scopeMode: this.settings.scopeMode,
			optInProperty: this.settings.optInProperty,
		};
	}

	/** (Re)arm the periodic background sweep to match current settings. */
	private scheduleReconcile(): void {
		if (this.reconcileIntervalId !== null) {
			window.clearInterval(this.reconcileIntervalId);
			this.reconcileIntervalId = null;
		}
		if (!this.settings.autoStamp) return;
		const ms = Math.max(1, this.settings.autoStampIntervalMinutes) * 60_000;
		this.reconcileIntervalId = window.setInterval(() => void this.runReconcile(), ms);
		this.registerInterval(this.reconcileIntervalId);
	}

	/** Background sweep: stamp un-dated items everywhere except the active file. */
	private async runReconcile(): Promise<void> {
		if (!this.settings.autoStamp || !this.store) return;
		const active = this.app.workspace.getActiveFile()?.path;
		await stampMissingDates(this.app, this.store, {
			exclude: active ? new Set([active]) : undefined,
		});
	}

	/** On leaving a note, stamp just that (now inactive) file's un-dated items. */
	private onLeafChange(): void {
		const active = this.app.workspace.getActiveFile()?.path ?? null;
		const left = this.lastActivePath;
		this.lastActivePath = active;
		if (!this.settings.autoStamp || !this.store) return;
		if (!left || left === active) return;
		void stampMissingDates(this.app, this.store, { only: new Set([left]) });
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
		this.store?.updateConfig(this.indexConfig());
		this.scheduleReconcile();
		this.syncConcealConfig();
		// Push conceal setting changes to open editors.
		this.app.workspace.updateOptions();
	}

	private syncConcealConfig(): void {
		this.concealConfig.enabled = this.settings.concealMetadata;
		this.concealConfig.concealTags = this.settings.concealTags;
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
