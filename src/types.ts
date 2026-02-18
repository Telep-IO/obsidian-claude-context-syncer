export interface SyncerSettings {
	vaultFolder: string;
	autoSync: boolean;
	syncOnStartup: boolean;
	lastSyncTime: number;
}

export const DEFAULT_SETTINGS: SyncerSettings = {
	vaultFolder: 'Claude',
	autoSync: true,
	syncOnStartup: true,
	lastSyncTime: 0,
};

export interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	input?: any;
	id?: string;
	signature?: string;
}

export interface ConversationEntry {
	type: string;
	message?: {
		role?: string;
		content?: string | ContentBlock[];
	};
	uuid: string;
	timestamp: string | number;
	sessionId?: string;
	cwd?: string;
	version?: string;
	gitBranch?: string;
	isSidechain?: boolean;
	isMeta?: boolean;
	parentUuid?: string | null;
	slug?: string;
	planContent?: string;
	[key: string]: any;
}

export interface SyncResult {
	success: boolean;
	project: string;
	file: string;
	action: 'created' | 'updated' | 'skipped' | 'error';
	error?: string;
}
