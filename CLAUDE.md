# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin that syncs Claude Code conversation contexts from `~/.claude/` into an Obsidian vault as readable Markdown files. Desktop only (requires Node.js APIs). Uses `chokidar` for file watching.

## Build Commands

- `npm run dev` — esbuild watch mode, outputs `main.js` with inline sourcemaps
- `npm run build` — type-check via `tsc -noEmit -skipLibCheck` then esbuild production build (no sourcemaps, tree-shaken)

No test framework is configured. No linter script is defined.

## Architecture

Entry point: `src/main.ts` — `ClaudeContextSyncPlugin` extends Obsidian's `Plugin`. Registers a command, settings tab, status bar item, and initializes the syncer.

**Core flow:**
1. `ContextSyncer` (`src/syncer.ts`) watches `~/.claude/projects/**/*.jsonl`, memory files, `settings.json`, and plans via chokidar
2. On file change, syncs are debounced (1s) and deduplicated via `syncInProgress` set
3. JSONL files are streamed line-by-line with `readline`, parsed into `ConversationEntry[]`
4. `convertToMarkdown` (`src/converter.ts`) filters noise (sidechains, meta, system entries), groups entries into user/assistant turns, renders tool uses as blockquotes, and produces Markdown with YAML frontmatter
5. Both the rendered `.md` and raw `.jsonl` are written to the vault via Obsidian's adapter API
6. Memory files, plans, and `settings.json` are copied as-is with mtime-based skip logic

**Key modules:**
- `src/types.ts` — `SyncerSettings`, `ConversationEntry`, `ContentBlock`, `SyncResult` interfaces
- `src/utils.ts` — `decodeProjectDir` decodes Claude's encoded project directory names (dash-separated path segments) into short project names using heuristic parent dir matching
- `src/settings.ts` — Obsidian settings tab UI
- `src/converter.ts` — JSONL-to-Markdown conversion; `SKIP_TYPES` set controls which entry types are filtered out

## Development Notes

- Output is `main.js` in the repo root (CJS format, ES2018 target). This is the file Obsidian loads.
- `obsidian` and Node.js builtins are externalized in the esbuild config — they're provided by Obsidian's runtime.
- `manifest.json` is the Obsidian plugin manifest; `isDesktopOnly: true` because of Node.js filesystem APIs.
- All vault writes use `this.plugin.app.vault.adapter` (Obsidian's abstraction), not direct `fs` writes. Source reads from `~/.claude/` use Node.js `fs` directly.
