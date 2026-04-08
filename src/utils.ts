import * as path from 'path';
import * as os from 'os';
export function getClaudeHome(): string {
	return path.join(os.homedir(), '.claude');
}

export function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (seconds < 60) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	return `${days}d ago`;
}

export function getErrorMessage(error: any): string {
	if (!error) return 'Unknown error';
	if (error.code) {
		switch (error.code) {
			case 'EACCES': return 'Permission denied';
			case 'ENOENT': return 'File or directory not found';
			case 'ENOSPC': return 'Disk full';
			default: return `File system error: ${error.code}`;
		}
	}
	return error.message || error.toString();
}

export function sanitizeFileName(name: string): string {
	return name
		.replace(/[<>:"|?*\\/]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.substring(0, 255);
}

/**
 * Decode an encoded project directory name to a short project name.
 * e.g. "-home-telep-Projects-mines-swept" -> "mines-swept"
 * Heuristic: find known parent dirs (Projects, repos, code, src, work, dev, home)
 * and take everything after. Fallback to the last segment.
 */
export function decodeProjectDir(encoded: string): string {
	// The encoded format uses dashes as separators: -home-telep-Projects-mines-swept
	// Split on the leading dash pattern. The encoding replaces / with -
	const segments = encoded.replace(/^-/, '').split('-');

	// Known parent directory names (case-insensitive match)
	const parentDirs = ['projects', 'repos', 'code', 'src', 'work', 'dev', 'sites', 'workspace', 'downloads'];

	// Find the last occurrence of a known parent dir
	let lastParentIdx = -1;
	for (let i = 0; i < segments.length; i++) {
		if (parentDirs.includes(segments[i].toLowerCase())) {
			lastParentIdx = i;
		}
	}

	if (lastParentIdx >= 0 && lastParentIdx < segments.length - 1) {
		return segments.slice(lastParentIdx + 1).join('-');
	}

	// Fallback: skip the first two segments (typically "home" and username)
	if (segments.length > 2) {
		return segments.slice(2).join('-');
	}

	return encoded;
}
