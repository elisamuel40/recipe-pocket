/**
 * Media public API (PRD R11, R12). Owner: media.
 * Everything runs on device; no network, no remote models.
 * Status and plan for audio/video speech recognition: docs/video-gate.md.
 */
export type { TranscriptDraft } from './transcript';
export {
  draftFromTranscript,
  MAX_TRANSCRIPT_CHARS,
  MAX_TRANSCRIPT_LINES,
  REVIEW_WARNING,
  UNTITLED_TRANSCRIPT,
} from './transcript';
export { captionsToPlainText, isCaptionFormat } from './captions';

/** Largest caption/transcript file the importer reads (bytes). */
export const MAX_TRANSCRIPT_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Whether on-device speech recognition for audio/video files is available in
 * this build. It is not: no speech model or inference runtime is bundled yet
 * (see docs/video-gate.md). Keep false until the R11 gate passes.
 */
export function isLocalSpeechRecognitionAvailable(): boolean {
  return false;
}
