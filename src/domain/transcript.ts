export type TranscriptRole = "user" | "assistant" | "tool" | "system" | "error";

export interface TranscriptMessage {
	id: string;
	role: TranscriptRole;
	text: string;
	timestamp: number;
	streaming?: boolean;
	metadata?: Record<string, unknown>;
}

export interface TranscriptMessageDelta {
	messageId: string;
	delta: string;
	timestamp: number;
}

export function createTranscriptMessage(
	id: string,
	role: TranscriptRole,
	text: string,
	timestamp: number,
	metadata?: Record<string, unknown>,
): TranscriptMessage {
	return {
		id,
		role,
		text,
		timestamp,
		metadata,
	};
}

export function applyDelta(
	message: TranscriptMessage,
	delta: TranscriptMessageDelta,
): TranscriptMessage {
	return {
		...message,
		text: message.text + delta.delta,
	};
}
