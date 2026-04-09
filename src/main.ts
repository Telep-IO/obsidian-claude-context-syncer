import { Plugin, Notice } from 'obsidian';
import { SyncerSettings, DEFAULT_SETTINGS } from './types';
import { ClaudeContextSyncSettingTab } from './settings';
import { ContextSyncer } from './syncer';
import { formatRelativeTime, getClaudeHome } from './utils';
import { promises as fs } from 'fs';

export default class ClaudeContextSyncPlugin extends Plugin {
	settings: SyncerSettings;
	syncer: ContextSyncer | null = null;
	statusBarItem: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new ClaudeContextSyncSettingTab(this.app, this));
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		this.addCommand({
			id: 'sync-claude-contexts',
			name: 'Sync claude contexts now',
			callback: async () => {
				if (!this.syncer) {
					new Notice('Claude syncer not initialized');
					return;
				}
				new Notice('Syncing claude contexts...');
				const results = await this.syncer.syncAll();
				const successCount = results.filter(r => r.success).length;
				new Notice(`Synced ${successCount} conversation(s)`);
			},
		});

		await this.initializeSyncer();
	}

	onunload() {
		if (this.syncer) {
			void this.syncer.stopWatching();
		}
	}

	async initializeSyncer(): Promise<void> {
		if (this.syncer) {
			await this.syncer.stopWatching();
		}

		// Verify ~/.claude exists
		const claudeHome = getClaudeHome();
		try {
			await fs.access(claudeHome);
		} catch {
			this.updateStatusBar('~/.claude not found');
			return;
		}

		this.syncer = new ContextSyncer(this);
		await this.syncer.initialize();
		this.updateStatusBar();
	}

	updateStatusBar(customStatus?: string): void {
		if (!this.statusBarItem) return;

		if (customStatus) {
			this.statusBarItem.setText(`Claude: ${customStatus}`);
			return;
		}

		if (this.settings.lastSyncTime === 0) {
			this.statusBarItem.setText('Claude: ready');
		} else {
			this.statusBarItem.setText(`Claude: ${formatRelativeTime(this.settings.lastSyncTime)}`);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<SyncerSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
