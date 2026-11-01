/**
 * Content script (isolated world). Injected only on explicit user action via
 * chrome.scripting. Registers a single function; does nothing on its own.
 * Results are returned to the service worker through executeScript.
 */
import { extractFromDocument } from '../extraction/index';

type G = typeof globalThis & { __recipePocketExtract?: () => unknown };

(globalThis as G).__recipePocketExtract = () => {
  const url = location.href;
  try {
    const outcome = extractFromDocument(document, url);
    return outcome.ok
      ? { ok: true, url, candidates: outcome.candidates, warnings: outcome.warnings }
      : { ok: false, url, code: outcome.code, warnings: outcome.warnings };
  } catch {
    return { ok: false, url, code: 'NO_RECIPE', warnings: ['Extraction failed unexpectedly.'] };
  }
};
