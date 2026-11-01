/**
 * Service worker: toolbar invocation, side-panel launch and messaging only
 * (ARCHITECTURE.md). Holds no recipe data; safe to terminate at any time.
 */
import {
  isExtractRequest,
  isTrustedSender,
  type ActionClicked,
  type ExtractionError,
  type ExtractionResult,
  type ErrorCode,
} from '../shared/messages';

const CONTENT_SCRIPT = 'content.js';
const EXTRACTION_TIMEOUT_MS = 5000;

// Open the panel synchronously inside the user gesture, then tell the panel.
// openPanelOnActionClick is left false so onClicked fires and activeTab is granted.
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId === undefined) return;
  void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  if (tab.id === undefined) return;
  const msg: ActionClicked = { type: 'ACTION_CLICKED', tabId: tab.id, windowId: tab.windowId };
  // The panel may still be loading; it also requests extraction on load.
  void chrome.runtime.sendMessage(msg).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isTrustedSender(sender) || sender.tab) return false; // only extension pages, never content scripts
  if (!isExtractRequest(message)) return false;
  void runExtraction(message.requestId, message.tabId).then(sendResponse);
  return true;
});

type ContentResult =
  | { ok: true; url: string; candidates: ExtractionResult['candidates']; warnings: string[] }
  | { ok: false; url: string; code: ErrorCode; warnings: string[] };

async function runExtraction(requestId: string, tabId: number): Promise<ExtractionResult | ExtractionError> {
  const fail = (code: ErrorCode): ExtractionError => ({ type: 'EXTRACTION_ERROR', requestId, code });
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
    const run = chrome.scripting.executeScript({
      target: { tabId },
      func: () => (globalThis as unknown as { __recipePocketExtract?: () => unknown }).__recipePocketExtract?.(),
    });
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), EXTRACTION_TIMEOUT_MS));
    const raced = await Promise.race([run, timeout]);
    if (raced === 'timeout') return fail('CANCELLED');
    const result = raced[0]?.result as ContentResult | undefined;
    if (!result) return fail('NO_RECIPE');
    if (!result.ok) return fail(result.code);
    return { type: 'EXTRACTION_RESULT', requestId, url: result.url, candidates: result.candidates, warnings: result.warnings };
  } catch {
    // No activeTab grant (tab switched), chrome:// / Web Store pages, PDFs, etc.
    return fail('RESTRICTED_PAGE');
  }
}
