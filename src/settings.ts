import { App, PluginSettingTab, Setting } from 'obsidian';
import ProjectItemsPlugin from './main';
import { DEFAULT_DIMENSIONS, DEFAULT_TREE_DIMENSION_ID } from './tags';
import { Dimension } from './types';
import { TagManagerModal } from './views/tag-manager';

export interface PMSettings {
	dimensions: Dimension[];
	treeDimId: string;
	debounceMs: number;
	rootFolder: string;
}

export const DEFAULT_SETTINGS: PMSettings = {
	dimensions: DEFAULT_DIMENSIONS,
	treeDimId: DEFAULT_TREE_DIMENSION_ID,
	debounceMs: 250,
	rootFolder: '',
};

export class PMSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: ProjectItemsPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Tree dimension')
			.setDesc('Dimension used for hierarchical grouping in the central view.')
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
			.setName('Root folder')
			.setDesc('Scan only this folder and its subfolders. Leave blank to scan the whole vault.')
			.addText(t => {
				t.setPlaceholder('Projects/work')
					.setValue(this.plugin.settings.rootFolder);
				t.onChange(async v => {
					this.plugin.settings.rootFolder = v.trim().replace(/\/$/, '');
					await this.plugin.persist();
				});
			});

		new Setting(containerEl)
			.setName('Dimensions')
			.setDesc('Add, edit, or remove dimensions used for tagging and filtering.')
			.addButton(btn => btn
				.setButtonText('Open dimension manager')
				.onClick(() => new TagManagerModal(this.app, this.plugin).open()));
	}
}
