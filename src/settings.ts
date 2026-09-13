import { App, PluginSettingTab, Setting } from 'obsidian';
import ProjectItemsPlugin from './main';
import { DEFAULT_DIMENSIONS, DEFAULT_TREE_DIMENSION_ID } from './tags';
import { Dimension } from './types';

export interface PMSettings {
	dimensions: Dimension[];
	treeDimId: string;
	debounceMs: number;
	rootFolder: string;
	scopeMode: 'all' | 'opt-in';       // 'opt-in' → only *.todo.md / frontmatter-marked files
	optInProperty: string;             // frontmatter key that opts a file in
	concealMetadata: boolean;          // hide %%...%% metadata in the editor
	concealTags: boolean;              // also hide inline #tags in the editor
	autoStamp: boolean;                // background reconciler: auto-add a date to un-dated items
	autoStampIntervalMinutes: number;  // periodic sweep interval
	canvasAutoOpen: boolean;           // reveal the canvas view whenever a .canvas is opened
}

export const DEFAULT_SETTINGS: PMSettings = {
	dimensions: DEFAULT_DIMENSIONS,
	treeDimId: DEFAULT_TREE_DIMENSION_ID,
	debounceMs: 250,
	rootFolder: '',
	scopeMode: 'all',
	optInProperty: 'todos',
	concealMetadata: true,
	concealTags: false,
	autoStamp: false,
	autoStampIntervalMinutes: 60,
	canvasAutoOpen: true,
};

export class PMSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ProjectItemsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Dimensions, tags and index scope')
			.setDesc('Dimensions, the folders and files that get indexed, and an inventory of every tag and metadata key in the vault live in their own tab.')
			.addButton(b => {
				b.setButtonText('Open management tab')
					.setCta()
					.onClick(() => void this.plugin.openManageTab());
			});

		new Setting(containerEl)
			.setName('Refresh debounce (ms)')
			.setDesc('Delay after a file change before re-parsing it.')
			.addText(t => {
				t.setValue(String(this.plugin.settings.debounceMs));
				t.onChange(async v => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 0) {
						this.plugin.settings.debounceMs = n;
						await this.plugin.persist();
					}
				});
			});

		new Setting(containerEl)
			.setName('Conceal metadata in editor')
			.setDesc('Hide %% ... %% metadata blocks while editing; the raw text is revealed on the line your cursor is on.')
			.addToggle(t => {
				t.setValue(this.plugin.settings.concealMetadata);
				t.onChange(async v => {
					this.plugin.settings.concealMetadata = v;
					await this.plugin.persist();
				});
			});

		new Setting(containerEl)
			.setName('Conceal tags in editor')
			.setDesc('Also hide inline #tags while editing (topics come from headings, so tags are usually secondary).')
			.addToggle(t => {
				t.setValue(this.plugin.settings.concealTags);
				t.onChange(async v => {
					this.plugin.settings.concealTags = v;
					await this.plugin.persist();
				});
			});

		new Setting(containerEl)
			.setName('Auto-add dates')
			.setDesc('Occasionally append today\'s date to items that have none (at startup, on a timer, and when you leave a file). Only adds a hidden %% added:DATE %% comment — never edits your text.')
			.addToggle(t => {
				t.setValue(this.plugin.settings.autoStamp);
				t.onChange(async v => {
					this.plugin.settings.autoStamp = v;
					await this.plugin.persist();
				});
			});

		new Setting(containerEl)
			.setName('Auto-add interval (minutes)')
			.setDesc('How often the background date sweep runs while "Auto-add dates" is on.')
			.addText(t => {
				t.setValue(String(this.plugin.settings.autoStampIntervalMinutes));
				t.onChange(async v => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 1) {
						this.plugin.settings.autoStampIntervalMinutes = Math.floor(n);
						await this.plugin.persist();
					}
				});
			});

		new Setting(containerEl)
			.setName('Follow canvases')
			.setDesc('Open the canvas view automatically when you open a .canvas file. The toolbar over the canvas appears either way once the view is open.')
			.addToggle(t => {
				t.setValue(this.plugin.settings.canvasAutoOpen);
				t.onChange(async v => {
					this.plugin.settings.canvasAutoOpen = v;
					await this.plugin.persist();
				});
			});
	}
}
