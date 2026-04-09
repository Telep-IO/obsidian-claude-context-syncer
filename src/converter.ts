import { ConversationEntry, ContentBlock } from './types';

interface ConversionResult {
	markdown: string;
	title: string;
	datePrefix: string;
}

const SKIP_TYPES = new Set([
	'system', 'progress', 'file-history-snapshot', 'queue-operation'
]);

/**
 * Convert parsed JSONL entries into readable Markdown.
 */
export function convertToMarkdown(entries: ConversationEntry[]): ConversionResult {
	// Filter out noise
	const relevant = entries.filter(e => {
		if (SKIP_TYPES.has(e.type)) return false;
		if (e.isSidechain) return false;
		if (e.isMeta) return false;
		return true;
	});

	// Extract metadata from first meaningful entry
	const firstUser = relevant.find(e => e.type === 'user' && isRealUserMessage(e));
	const firstEntry = relevant[0];
	const sessionId = firstEntry?.sessionId || 'unknown';
	const cwd = firstEntry?.cwd || '';
	const gitBranch = relevant.find(e => e.gitBranch)?.gitBranch || '';
	const timestamp = firstEntry?.timestamp;
	const date = timestamp ? new Date(timestamp) : new Date();
	const datePrefix = formatDatePrefix(date);
	const dateDisplay = formatDateDisplay(date);

	// Derive project name from cwd
	const projectName = cwd ? cwd.split('/').pop() || cwd : '';

	// Derive title from first user message
	const title = deriveTitle(firstUser);

	// Count real messages (user + assistant text)
	const messageCount = relevant.filter(e =>
		(e.type === 'user' && isRealUserMessage(e)) || e.type === 'assistant'
	).length;

	// Build markdown
	const lines: string[] = [];

	// YAML frontmatter
	lines.push('---');
	lines.push(`session: ${sessionId}`);
	if (cwd) lines.push(`project: ${cwd}`);
	lines.push(`date: ${datePrefix}`);
	if (gitBranch) lines.push(`branch: ${gitBranch}`);
	lines.push(`messages: ${messageCount}`);
	lines.push('---');
	lines.push('');

	// Title
	lines.push(`# ${title}`);
	lines.push('');

	// Subtitle
	const subtitleParts: string[] = [];
	if (projectName) subtitleParts.push(`**Project**: ${projectName}`);
	subtitleParts.push(`**Date**: ${dateDisplay}`);
	if (gitBranch) subtitleParts.push(`**Branch**: ${gitBranch}`);
	lines.push(`> ${subtitleParts.join(' | ')}`);
	lines.push('');

	// Process messages into turns
	const turns = buildTurns(relevant);

	for (const turn of turns) {
		lines.push('---');
		lines.push('');

		if (turn.role === 'user') {
			lines.push('## User');
			lines.push('');
			lines.push(turn.content);
			lines.push('');
		} else {
			lines.push('## Claude');
			lines.push('');
			lines.push(turn.content);
			lines.push('');
		}
	}

	return {
		markdown: lines.join('\n'),
		title,
		datePrefix,
	};
}

interface Turn {
	role: 'user' | 'assistant';
	content: string;
}

function isRealUserMessage(entry: ConversationEntry): boolean {
	if (!entry.message) return false;
	const content = entry.message.content;
	// Real user messages have string content or text blocks
	// Tool results have content as array with tool_result type blocks
	if (typeof content === 'string') return true;
	if (Array.isArray(content)) {
		return content.some(b => b.type === 'text') &&
			!content.some(b => b.type === 'tool_result');
	}
	return false;
}

function buildTurns(entries: ConversationEntry[]): Turn[] {
	const turns: Turn[] = [];
	let currentAssistantParts: string[] = [];
	let inAssistantTurn = false;

	function flushAssistant() {
		if (inAssistantTurn && currentAssistantParts.length > 0) {
			turns.push({
				role: 'assistant',
				content: currentAssistantParts.join('\n\n'),
			});
		}
		currentAssistantParts = [];
		inAssistantTurn = false;
	}

	for (const entry of entries) {
		if (entry.type === 'user' && isRealUserMessage(entry)) {
			flushAssistant();
			turns.push({
				role: 'user',
				content: extractUserContent(entry),
			});
		} else if (entry.type === 'assistant') {
			inAssistantTurn = true;
			const rendered = renderAssistantEntry(entry);
			if (rendered) {
				currentAssistantParts.push(rendered);
			}
		}
		// Skip tool_result user messages, progress, etc.
	}

	flushAssistant();
	return turns;
}

function extractUserContent(entry: ConversationEntry): string {
	if (!entry.message) return '';
	const content = entry.message.content;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter(b => b.type === 'text' && b.text)
			.map(b => b.text!)
			.join('\n\n');
	}
	return '';
}

function renderAssistantEntry(entry: ConversationEntry): string | null {
	if (!entry.message?.content) return null;
	const content = entry.message.content;
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return null;

	const parts: string[] = [];

	for (const block of content) {
		switch (block.type) {
			case 'text':
				if (block.text) parts.push(block.text);
				break;
			case 'tool_use':
				parts.push(renderToolUse(block));
				break;
			case 'thinking':
				// Skip thinking blocks
				break;
			default:
				// Skip unknown block types
				break;
		}
	}

	return parts.length > 0 ? parts.join('\n\n') : null;
}

function renderToolUse(block: ContentBlock): string {
	const name = block.name || 'Unknown';
	const input = block.input || {};
	const str = (key: string): string =>
		typeof input[key] === 'string' ? input[key] : '';

	// Create a brief summary of what the tool does
	let summary = '';
	if (input.command) {
		summary = `\`${truncate(str('command'), 100)}\``;
	} else if (input.file_path) {
		summary = `\`${str('file_path')}\``;
	} else if (input.pattern) {
		summary = `\`${str('pattern')}\``;
	} else if (input.query) {
		summary = `\`${truncate(str('query'), 100)}\``;
	} else if (input.prompt) {
		summary = `\`${truncate(str('prompt'), 100)}\``;
	} else if (input.content) {
		summary = `${truncate(str('content'), 80)}`;
	} else if (input.old_string) {
		summary = `edit in \`${str('file_path') || 'file'}\``;
	}

	if (summary) {
		return `> **Tool**: \`${name}\` — ${summary}`;
	}
	return `> **Tool**: \`${name}\``;
}

function deriveTitle(firstUser: ConversationEntry | undefined): string {
	if (!firstUser) return 'Untitled Conversation';

	const content = extractUserContent(firstUser);
	if (!content) return 'Untitled Conversation';

	// Take first line, clean it up
	let title = content.split('\n')[0].trim();

	// Remove common prefixes
	title = title.replace(/^(implement|fix|add|create|update|build|write|make|help me|can you|please)\s+/i, (match) => {
		// Capitalize first letter
		return match.charAt(0).toUpperCase() + match.slice(1);
	});

	// Truncate
	if (title.length > 80) {
		title = title.substring(0, 77) + '...';
	}

	return title || 'Untitled Conversation';
}

function formatDatePrefix(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function formatDateDisplay(date: Date): string {
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return str.substring(0, max - 3) + '...';
}
