/**
 * Domain public API: rational arithmetic, ingredient parsing, scaling, unit
 * conversion, shopping-list merging, URL normalization (PRD R04, R05, R09).
 * Owner: domain. Pure, synchronous, no DOM, no chrome.* APIs.
 * Implementations live in sibling files and are re-exported here; these
 * signatures are stable (UI, extraction and storage import them).
 */
export type { DisplayIngredient, ParsedIngredient, QuantityRange, Rational, RenderOptions } from './types';

// ---- Rational arithmetic ----
export {
  add,
  addRanges,
  cmp,
  div,
  eq,
  formatDecimal,
  formatRational,
  fromDecimalString,
  fromNumber,
  fromQuantityV1,
  mul,
  rational,
  roundTo,
  scaleRange,
  sub,
  toNumber,
  toQuantityV1,
} from './rational';

// ---- Parsing ----
export { parseIngredientLine, parseServingsInput, parseYield, toIngredientItem } from './parse';

// ---- Units ----
export { convertQuantity, UNITS, type Dimension, type UnitDef } from './units';

// ---- Scaling and conversion ----
export {
  convertForSystem,
  formatMetricNumber,
  formatRange,
  NOTES,
  originalServings,
  renderIngredient,
  scaleFactorForServings,
  unitLabel,
} from './render';

// ---- Shopping lists ----
export { AISLES, buildShoppingItems, defaultAisle, normalizeKeyText } from './shopping';

// ---- URLs ----
export { isTrackingParam, normalizeSourceUrl } from './url';
