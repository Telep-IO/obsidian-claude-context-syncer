# Claude Context Syncer

An [Obsidian](https://obsidian.md) plugin that syncs [Claude Code](https://docs.anthropic.com/en/docs/claude-code) conversation contexts from `~/.claude/` into your vault as readable Markdown files.

## What it does

Claude Code stores conversations as JSONL files in `~/.claude/projects/`. This plugin watches that directory, converts conversations to readable Markdown, and writes them into your Obsidian vault. Once in your vault, they sync across devices via Obsidian Sync (or any other sync method).

Each conversation becomes a Markdown file with YAML frontmatter (session ID, project path, date, git branch, message count) and formatted user/assistant turns. The raw `.jsonl` is also copied alongside for programmatic access.

## Installation

### From community plugins

1. Open Settings > Community Plugins
2. Search for "Claude Context Syncer"
3. Click Install, then Enable

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/telepio/claude-code-context-syncer/releases)
2. Create a folder in your vault: `.obsidian/plugins/claude-context-syncer/`
3. Copy the downloaded files into that folder
4. Reload Obsidian and enable the plugin in Settings > Community Plugins

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Vault folder | `Claude` | Folder within your vault where synced data is stored |
| Auto-sync | Enabled | Watch for file changes and sync automatically |
| Sync on startup | Enabled | Sync all conversations when Obsidian starts |
| Sync now | — | Button to manually trigger a full sync |

## Vault structure

```
Your Vault/
└── Claude/
    ├── Conversations/
    │   ├── my-project/
    │   │   ├── 2026-02-20 Fix authentication bug.md
    │   │   ├── 2026-02-20 Fix authentication bug.jsonl
    │   │   └── memory/
    │   │       └── MEMORY.md
    │   └── another-project/
    │       └── 2026-02-19 Add search feature.md
    ├── Plans/
    │   └── some-plan.md
    └── settings.json
```

The `.md` files are visible in Obsidian's sidebar. The `.jsonl` files sit alongside them on disk for your own use.

## Commands

- **Sync Claude contexts now** — Trigger a full sync from the command palette (`Ctrl/Cmd+P`)

## Data and privacy

- **Reads files outside your vault**: This plugin reads from `~/.claude/` on your local filesystem. It does not modify anything in `~/.claude/`.
- **All data stays local**: No network requests are made.
- **Desktop only**: Requires Node.js APIs for file watching (Windows, macOS, Linux).
- **Sensitive content**: Your conversations may contain sensitive information. Be mindful of this if using cloud-based vault sync.

## Development

```bash
npm install
npm run dev     # Watch mode with sourcemaps
npm run build   # Type-check and production build
```

To test locally, symlink or copy the built `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/claude-context-syncer/` directory and reload Obsidian.

## Releasing

Push a version tag to trigger the GitHub Actions workflow:

```bash
npm version patch   # bumps version in package.json, manifest.json, versions.json
git push --follow-tags
```

This creates a GitHub Release with the plugin assets automatically.

## License

MIT — see [LICENSE](LICENSE) for details.
