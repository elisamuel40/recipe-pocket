/** Print page entry (R06). Reads a draft from the side panel or a saved recipe from storage. */
import { isPrintDraftResponse, type PrintDraftRequest } from '../shared/messages';
import { getRecipe } from '../storage/index';
import { rational } from '../domain/index';
import { loadAndApplyPreferences } from './common/prefs';
import { parsePrintParams, type PrintViewOptions } from './common/print-params';
import { isRecipeLike } from './common/reader-state';
import { renderPrintPage, renderPrintProblem } from './components/print-view';

const SYSTEMS = ['original', 'us', 'metric'] as const;

function reduce(n: number, d: number) {
  try {
    return rational(n, d);
  } catch {
    return { n, d };
  }
}

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) return;
  await loadAndApplyPreferences();
  const params = parsePrintParams(location.search);
  if (!params) {
    renderPrintProblem(root, 'Nothing to print', 'Open the print view from the side panel or the library.');
    return;
  }
  if (params.kind === 'saved') {
    const recipe = await getRecipe(params.recipeId).catch(() => undefined);
    if (!recipe) {
      renderPrintProblem(root, 'Recipe not found', 'This recipe is no longer saved on this device.');
      return;
    }
    renderPrintPage(root, recipe, { ...params.options, factor: reduce(params.options.factor.n, params.options.factor.d) });
    return;
  }
  const req: PrintDraftRequest = { type: 'PRINT_DRAFT_REQUEST', printId: params.printId };
  const res: unknown = await chrome.runtime.sendMessage(req).catch(() => undefined);
  if (!isPrintDraftResponse(res) || res.printId !== params.printId || !isRecipeLike(res.recipe)) {
    renderPrintProblem(
      root,
      'Recipe no longer available',
      'Unsaved recipes are discarded when the side panel closes. Read the page again and select Print, or save the recipe first.',
    );
    return;
  }
  const o = res.options;
  const valid = (v: unknown) => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1_000_000;
  const options: PrintViewOptions = {
    factor: valid(o.factorNumerator) && valid(o.factorDenominator) ? reduce(o.factorNumerator, o.factorDenominator) : { n: 1, d: 1 },
    system: (SYSTEMS as readonly string[]).includes(o.unitSystem) ? o.unitSystem : 'original',
    includeNotes: o.includeNotes !== false,
  };
  renderPrintPage(root, res.recipe, options);
}

void main();
