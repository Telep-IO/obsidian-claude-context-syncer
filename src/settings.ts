import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import ClaudeContextSyncPlugin from './main';
import { formatRelativeTime, getErrorMessage } from './utils';

export class ClaudeContextSyncSettingTab extends PluginSettingTab {
	plugin: ClaudeContextSyncPlugin;

	constructor(app: App, plugin: ClaudeContextSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Vault folder')
			.setDesc('Folder within your vault where Claude data will be synced')
			.addText(text => text
				.setPlaceholder('Claude')
				.setValue(this.plugin.settings.vaultFolder)
				.onChange(async (value) => {
					this.plugin.settings.vaultFolder = value || 'Claude';
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-sync')
			.setDesc('Automatically sync when Claude Code creates or modifies files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSync)
				.onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();

					if (value) {
						await this.plugin.initializeSyncer();
					} else {
						await this.plugin.syncer?.stopWatching();
					}
				}));

		new Setting(containerEl)
			.setName('Sync on startup')
			.setDesc('Automatically sync all conversations when Obsidian starts')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.syncOnStartup)
				.onChange(async (value) => {
					this.plugin.settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync now')
			.setDesc('Manually sync all Claude contexts')
			.addButton(button => button
				.setButtonText('Sync Now')
				.setCta()
				.onClick(async () => {
					if (!this.plugin.syncer) {
						new Notice('Syncer not initialized');
						return;
					}

					button.setDisabled(true);
					button.setButtonText('Syncing...');

					try {
						const results = await this.plugin.syncer.syncAll();
						const successCount = results.filter(r => r.success).length;
						const errorCount = results.filter(r => r.action === 'error').length;

						if (errorCount === 0) {
							new Notice(`Synced ${successCount} conversation(s)`);
						} else {
							new Notice(`Synced ${successCount}, ${errorCount} error(s)`);
						}
					} catch (error: any) {
						new Notice(`Sync failed: ${getErrorMessage(error)}`);
					} finally {
						button.setDisabled(false);
						button.setButtonText('Sync Now');
						this.display(); // Refresh to update last sync time
					}
				}));

		// Status display
		if (this.plugin.settings.lastSyncTime > 0) {
			const statusEl = containerEl.createDiv('claude-sync-status');
			statusEl.createEl('small', {
				text: `Last sync: ${formatRelativeTime(this.plugin.settings.lastSyncTime)}`,
				cls: 'setting-item-description',
			});
		}
	}
}
