import * as chokidar from 'chokidar';
import { FSWatcher } from 'chokidar';
import * as path from 'path';
import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { Notice } from 'obsidian';
import ClaudeContextSyncPlugin from './main';
import { ConversationEntry, SyncResult } from './types';
import { getClaudeHome, decodeProjectDir, ensureDirectory, sanitizeFileName, getErrorMessage } from './utils';
import { convertToMarkdown } from './converter';

export class ContextSyncer {
	private plugin: ClaudeContextSyncPlugin;
	private watcher: FSWatcher | null = null;
	private pendingSyncs: Map<string, NodeJS.Timeout> = new Map();
	private syncInProgress: Set<string> = new Set();

	constructor(plugin: ClaudeContextSyncPlugin) {
		this.plugin = plugin;
	}

	async initialize(): Promise<void> {
		const claudeHome = getClaudeHome();

		try {
			await fs.access(claudeHome);
		} catch {
			new Notice('Claude Context Syncer: ~/.claude not found');
			console.warn('Claude Context Syncer: ~/.claude does not exist');
			return;
		}

		if (this.plugin.settings.autoSync) {
			await this.startWatching();
		}

		if (this.plugin.settings.syncOnStartup) {
			setTimeout(() => this.syncAll(), 1000);
		}
	}

	async startWatching(): Promise<void> {
		if (this.watcher) return;

		const claudeHome = getClaudeHome();
		const projectsDir = path.join(claudeHome, 'projects');

		try {
			await fs.access(projectsDir);
		} catch {
			console.warn('Claude Context Syncer: ~/.claude/projects not found');
			return;
		}

		const watchPaths = [
			path.join(projectsDir, '**/*.jsonl'),
			path.join(projectsDir, '**/memory/*'),
			path.join(claudeHome, 'settings.json'),
			path.join(claudeHome, 'plans', '*.md'),
		];

		this.watcher = chokidar.watch(watchPaths, {
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 500,
				pollInterval: 100,
			},
			followSymlinks: true,
		});

		this.watcher
			.on('add', (filePath) => this.scheduleSync(filePath))
			.on('change', (filePath) => this.scheduleSync(filePath))
			.on('error', (error) => {
				console.error('Claude Context Syncer: Watcher error', error);
				setTimeout(async () => {
					await this.stopWatching();
					await this.startWatching();
				}, 5000);
			});
	}

	async stopWatching(): Promise<void> {
		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
		for (const timeout of this.pendingSyncs.values()) {
			clearTimeout(timeout);
		}
		this.pendingSyncs.clear();
	}

	private scheduleSync(filePath: string): void {
		const existing = this.pendingSyncs.get(filePath);
		if (existing) clearTimeout(existing);

		const timeout = setTimeout(() => {
			this.pendingSyncs.delete(filePath);
			this.syncFile(filePath);
		}, 1000);

		this.pendingSyncs.set(filePath, timeout);
	}

	/**
	 * Sync all Claude content to the vault.
	 */
	async syncAll(): Promise<SyncResult[]> {
		const results: SyncResult[] = [];
		const claudeHome = getClaudeHome();
		const projectsDir = path.join(claudeHome, 'projects');

		try {
			// Sync conversations
			const projectDirs = await this.listDirectories(projectsDir);
			let totalFiles = 0;
			const filesByProject: Map<string, string[]> = new Map();

			for (const dir of projectDirs) {
				const dirPath = path.join(projectsDir, dir);
				const files = await this.listFiles(dirPath, '.jsonl');
				if (files.length > 0) {
					filesByProject.set(dir, files.map(f => path.join(dirPath, f)));
					totalFiles += files.length;
				}
			}

			if (totalFiles > 0) {
				this.plugin.updateStatusBar(`Syncing... 0/${totalFiles}`);
				let synced = 0;

				for (const [, files] of filesByProject) {
					for (const filePath of files) {
						const result = await this.syncFile(filePath);
						results.push(result);
						synced++;
						this.plugin.updateStatusBar(`Syncing... ${synced}/${totalFiles}`);
					}
				}
			}

			// Sync memory directories
			for (const dir of projectDirs) {
				const memoryDir = path.join(projectsDir, dir, 'memory');
				try {
					const memoryFiles = await fs.readdir(memoryDir);
					for (const file of memoryFiles) {
						await this.syncMemoryFile(
							path.join(memoryDir, file),
							dir
						);
					}
				} catch {
					// No memory dir for this project, skip
				}
			}

			// Sync settings.json
			await this.syncSimpleFile(
				path.join(claudeHome, 'settings.json'),
				'settings.json'
			);

			// Sync plans
			const plansDir = path.join(claudeHome, 'plans');
			try {
				const planFiles = await this.listFiles(plansDir, '.md');
				for (const file of planFiles) {
					await this.syncSimpleFile(
						path.join(plansDir, file),
						path.join('Plans', file)
					);
				}
			} catch {
				// No plans dir, skip
			}

			// Update status
			this.plugin.settings.lastSyncTime = Date.now();
			await this.plugin.saveSettings();
			this.plugin.updateStatusBar();

			const successCount = results.filter(r => r.success).length;
			console.log(`Claude Context Syncer: Sync complete — ${successCount}/${results.length} conversations synced`);

		} catch (error) {
			console.error('Claude Context Syncer: Sync error', error);
			new Notice(`Sync error: ${getErrorMessage(error)}`);
		}

		return results;
	}

	/**
	 * Sync a single JSONL conversation file: copy raw + convert to Markdown.
	 */
	private async syncFile(filePath: string): Promise<SyncResult> {
		if (this.syncInProgress.has(filePath)) {
			return { success: false, project: '', file: '', action: 'skipped', error: 'Already syncing' };
		}
		this.syncInProgress.add(filePath);

		try {
			// Determine project name from parent directory
			const parentDir = path.basename(path.dirname(filePath));

			// Check if this is a conversation JSONL
			if (!filePath.endsWith('.jsonl')) {
				return { success: true, project: parentDir, file: path.basename(filePath), action: 'skipped' };
			}

			const projectName = decodeProjectDir(parentDir);
			const sanitizedProject = sanitizeFileName(projectName);
			const vaultBase = this.getVaultBasePath();
			const destDir = path.join(vaultBase, this.plugin.settings.vaultFolder, 'Conversations', sanitizedProject);

			// Check mtime — skip if destination is up to date
			const shouldSync = await this.needsSync(filePath, destDir, path.basename(filePath));
			if (!shouldSync) {
				return { success: true, project: projectName, file: path.basename(filePath), action: 'skipped' };
			}

			await ensureDirectory(destDir);

			// Parse JSONL
			const entries = await this.parseJsonl(filePath);
			if (entries.length === 0) {
				return { success: false, project: projectName, file: path.basename(filePath), action: 'skipped', error: 'Empty file' };
			}

			// Copy raw JSONL
			const rawContent = await fs.readFile(filePath, 'utf-8');
			const rawDest = path.join(destDir, path.basename(filePath));
			await fs.writeFile(rawDest, rawContent, 'utf-8');

			// Convert to Markdown
			const { markdown, title, datePrefix } = convertToMarkdown(entries);
			const mdFileName = sanitizeFileName(`${datePrefix} ${title}`) + '.md';
			const mdDest = path.join(destDir, mdFileName);
			await fs.writeFile(mdDest, markdown, 'utf-8');

			// Also rename the raw JSONL copy to match
			const jsonlFileName = sanitizeFileName(`${datePrefix} ${title}`) + '.jsonl';
			const jsonlDest = path.join(destDir, jsonlFileName);
			if (jsonlDest !== rawDest) {
				// Remove old UUID-named copy, write with friendly name
				await fs.unlink(rawDest).catch(() => {});
				await fs.writeFile(jsonlDest, rawContent, 'utf-8');
			}

			this.plugin.settings.lastSyncTime = Date.now();

			return { success: true, project: projectName, file: mdFileName, action: 'updated' };
		} catch (error: any) {
			return { success: false, project: '', file: path.basename(filePath), action: 'error', error: getErrorMessage(error) };
		} finally {
			this.syncInProgress.delete(filePath);
		}
	}

	/**
	 * Sync a memory file (e.g. MEMORY.md) for a project.
	 */
	private async syncMemoryFile(filePath: string, encodedProjectDir: string): Promise<void> {
		try {
			const projectName = decodeProjectDir(encodedProjectDir);
			const sanitizedProject = sanitizeFileName(projectName);
			const vaultBase = this.getVaultBasePath();
			const destDir = path.join(vaultBase, this.plugin.settings.vaultFolder, 'Conversations', sanitizedProject, 'memory');

			const destFile = path.join(destDir, path.basename(filePath));

			// Check mtime
			const srcStat = await fs.stat(filePath);
			try {
				const destStat = await fs.stat(destFile);
				if (destStat.mtimeMs >= srcStat.mtimeMs) return;
			} catch {
				// dest doesn't exist, proceed
			}

			await ensureDirectory(destDir);
			const content = await fs.readFile(filePath, 'utf-8');
			await fs.writeFile(destFile, content, 'utf-8');
		} catch (error) {
			console.warn(`Claude Context Syncer: Failed to sync memory file ${filePath}`, error);
		}
	}

	/**
	 * Sync a simple file (settings.json, plan .md files).
	 */
	private async syncSimpleFile(srcPath: string, relativeDest: string): Promise<void> {
		try {
			const srcStat = await fs.stat(srcPath);
			const vaultBase = this.getVaultBasePath();
			const destPath = path.join(vaultBase, this.plugin.settings.vaultFolder, relativeDest);

			// Check mtime
			try {
				const destStat = await fs.stat(destPath);
				if (destStat.mtimeMs >= srcStat.mtimeMs) return;
			} catch {
				// dest doesn't exist
			}

			await ensureDirectory(path.dirname(destPath));
			const content = await fs.readFile(srcPath, 'utf-8');
			await fs.writeFile(destPath, content, 'utf-8');
		} catch (error) {
			console.warn(`Claude Context Syncer: Failed to sync ${srcPath}`, error);
		}
	}

	/**
	 * Check if a conversation needs syncing by comparing source mtime
	 * against any existing files in the destination directory.
	 */
	private async needsSync(srcPath: string, destDir: string, srcFileName: string): Promise<boolean> {
		try {
			const srcStat = await fs.stat(srcPath);

			// Check if dest directory exists
			try {
				await fs.access(destDir);
			} catch {
				return true; // Dir doesn't exist, need to sync
			}

			// Look for any file derived from this source
			// The JSONL filename is a UUID, and we create friendly-named copies.
			// Check if any JSONL in destDir has same content by checking for
			// a raw JSONL copy. We use a simple approach: check all .jsonl files in dest.
			const destFiles = await fs.readdir(destDir);
			const jsonlFiles = destFiles.filter(f => f.endsWith('.jsonl'));

			if (jsonlFiles.length === 0) return true;

			// Check if source is newer than the newest dest JSONL
			for (const jf of jsonlFiles) {
				const destStat = await fs.stat(path.join(destDir, jf));
				if (destStat.mtimeMs >= srcStat.mtimeMs) return false;
			}

			return true;
		} catch {
			return true;
		}
	}

	private async parseJsonl(filePath: string): Promise<ConversationEntry[]> {
		const entries: ConversationEntry[] = [];
		const fileStream = createReadStream(filePath);
		const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

		for await (const line of rl) {
			if (!line.trim()) continue;
			try {
				entries.push(JSON.parse(line) as ConversationEntry);
			} catch {
				// Skip unparseable lines
			}
		}

		return entries;
	}

	private async listDirectories(dirPath: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });
			return entries.filter(e => e.isDirectory()).map(e => e.name);
		} catch {
			return [];
		}
	}

	private async listFiles(dirPath: string, extension: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dirPath);
			return entries.filter(f => f.endsWith(extension));
		} catch {
			return [];
		}
	}

	private getVaultBasePath(): string {
		return (this.plugin.app.vault.adapter as any).basePath;
	}
}
