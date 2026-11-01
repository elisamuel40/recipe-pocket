/**
 * Media public API (PRD R11, R12). Owner: media.
 * Everything runs on device; no network, no remote models.
 */
import type { RecipeV1 } from '../shared/types';

export interface TranscriptDraft {
  /** Draft recipe; extraction.method = 'transcript'. Must be reviewed before Save. */
  recipe: RecipeV1;
  /** Lines the parser could not classify, shown to the user for manual placement. */
  unclassified: string[];
  warnings: string[];
}

const todo = (name: string): never => {
  throw new Error(`${name}: not implemented`);
};

/**
 * Turn user-supplied transcript/caption text (plain text, SRT or WebVTT) into
 * a draft recipe. Never invents quantities or steps; unknown lines go to
 * `unclassified`.
 */
export function draftFromTranscript(text: string, opts: { title?: string; sourceUrl?: string }): TranscriptDraft {
  void text;
  void opts;
  return todo('draftFromTranscript');
}

/** Detect and strip SRT/WebVTT timing so the result is plain caption text. */
export function captionsToPlainText(text: string): string {
  void text;
  return todo('captionsToPlainText');
}

/** Whether on-device speech recognition for audio/video files is available in this build. */
export function isLocalSpeechRecognitionAvailable(): boolean {
  return false;
}
