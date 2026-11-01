/**
 * Runtime message contracts (ARCHITECTURE.md "Messages").
 * All messages are internal to the extension. Validate every inbound message
 * with the guards below and check sender.id === chrome.runtime.id.
 */
import type { RecipeV1 } from './types';

export const ERROR_CODES = [
  'RESTRICTED_PAGE',
  'NO_RECIPE',
  'PARTIAL_RECIPE',
  'PAGE_CHANGED',
  'INPUT_TOO_LARGE',
  'QUOTA',
  'INVALID_BACKUP',
  'UNSUPPORTED_MEDIA',
  'CANCELLED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ExtractRequest {
  type: 'EXTRACT';
  requestId: string;
  tabId: number;
}

export interface ExtractionResult {
  type: 'EXTRACTION_RESULT';
  requestId: string;
  url: string;
  candidates: RecipeV1[];
  warnings: string[];
}

export interface ExtractionError {
  type: 'EXTRACTION_ERROR';
  requestId: string;
  code: ErrorCode;
}

/** Service worker -> side panel: toolbar icon was clicked on this tab. */
export interface ActionClicked {
  type: 'ACTION_CLICKED';
  tabId: number;
  windowId: number;
}

/** Print page -> side panel: request the unsaved draft currently displayed. */
export interface PrintDraftRequest {
  type: 'PRINT_DRAFT_REQUEST';
  printId: string;
}

export interface PrintDraftResponse {
  type: 'PRINT_DRAFT_RESPONSE';
  printId: string;
  recipe: RecipeV1 | null;
  /** View options chosen in the reader. */
  options: PrintOptions;
}

export interface PrintOptions {
  /** Scale factor as reduced rational. */
  factorNumerator: number;
  factorDenominator: number;
  unitSystem: 'original' | 'us' | 'metric';
  includeNotes: boolean;
}

export type ExtensionMessage =
  | ExtractRequest
  | ExtractionResult
  | ExtractionError
  | ActionClicked
  | PrintDraftRequest
  | PrintDraftResponse;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function isErrorCode(v: unknown): v is ErrorCode {
  return isStr(v) && (ERROR_CODES as readonly string[]).includes(v);
}

export function isExtractRequest(m: unknown): m is ExtractRequest {
  return isObj(m) && m.type === 'EXTRACT' && isStr(m.requestId) && isInt(m.tabId);
}

export function isExtractionResult(m: unknown): m is ExtractionResult {
  return (
    isObj(m) &&
    m.type === 'EXTRACTION_RESULT' &&
    isStr(m.requestId) &&
    isStr(m.url) &&
    Array.isArray(m.candidates) &&
    Array.isArray(m.warnings) &&
    m.warnings.every(isStr)
  );
}

export function isExtractionError(m: unknown): m is ExtractionError {
  return isObj(m) && m.type === 'EXTRACTION_ERROR' && isStr(m.requestId) && isErrorCode(m.code);
}

export function isActionClicked(m: unknown): m is ActionClicked {
  return isObj(m) && m.type === 'ACTION_CLICKED' && isInt(m.tabId) && isInt(m.windowId);
}

export function isPrintDraftRequest(m: unknown): m is PrintDraftRequest {
  return isObj(m) && m.type === 'PRINT_DRAFT_REQUEST' && isStr(m.printId);
}

export function isPrintDraftResponse(m: unknown): m is PrintDraftResponse {
  return (
    isObj(m) &&
    m.type === 'PRINT_DRAFT_RESPONSE' &&
    isStr(m.printId) &&
    (m.recipe === null || isObj(m.recipe)) &&
    isObj(m.options)
  );
}

/** Messages must come from this extension, never from web pages or other extensions. */
export function isTrustedSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
