/**
 * Storage error type and limits. Kept in a leaf module so every storage file
 * can import it without cycles; re-exported from ./index.
 */

export type StorageErrorCode =
  | 'QUOTA'
  | 'INVALID_BACKUP'
  | 'CONFLICT'
  | 'SESSION_ONLY'
  | 'NOT_FOUND'
  /** A record passed to a save function failed schema validation. */
  | 'INVALID_RECORD'
  /** Image is not PNG/JPEG/WebP, exceeds the size limit or cannot be decoded/re-encoded. */
  | 'UNSUPPORTED_MEDIA'
  /** deleteAllData timed out waiting for other open connections to close. */
  | 'BLOCKED';

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export const DB_NAME = 'recipe-pocket';
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Maximum nesting depth (objects + arrays) accepted in a backup file. */
export const IMPORT_MAX_DEPTH = 30;

/** Map low-level IndexedDB/DOM failures to StorageError where a code applies. */
export function mapError(err: unknown): unknown {
  if (err instanceof StorageError) return err;
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'QuotaExceededError') {
    return new StorageError('QUOTA', 'Not enough storage space on this device. Nothing was changed.');
  }
  return err;
}
