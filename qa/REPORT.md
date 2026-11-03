# Recipe Pocket QA report: real-browser E2E run

- **Date:** November 2, 2026 (America/Puerto_Rico).
- **Browser:** Chrome for Testing 153.0.8010.12 (Playwright Chromium build 1243), `--headless=new`, macOS arm64.
- **Build:** version 0.1.2, branch `store-readiness`, uncommitted tree recorded in `qa/e2e-results.json`. `dist/` passed `scripts/audit-dist.mjs`.
- **Evidence:** `qa/e2e-results.json`, `qa/screenshots/` (fixture screenshots only; live-site screenshots are kept out of the repository because they show third-party content).
- **Reproduce:** `npm run e2e`.

## Result
38 pass, 6 blocked, 0 fail. Blocked means the live site returned an HTTP 403 Cloudflare challenge to headless Chrome; challenges were not bypassed. Blocked is not a pass.

The toolbar click was automated with the Chrome DevTools Protocol method `Extensions.triggerAction` (test-only flag `--enable-unsafe-extension-debugging`). It runs the same path as a real click: `chrome.action.onClicked` fires, the side panel opens and `activeTab` is granted. `dist/` was tested as shipped, without `host_permissions`.

## Checks (all pass)
- Extension loads; service worker registers; permissions only `activeTab`, `scripting`, `sidePanel`.
- Onboarding; complete JSON-LD; multiple-recipe picker; empty JSON-LD with page-layout fallback; Smitten-Kitchen-like fixture (variants kept, comments excluded); older-blog-layout fixture; no recipe; `chrome://version` and `about:blank` reported as restricted.
- Servings 0.5x, 2x and reset; metric and US units (approximate marker, no cups-to-grams).
- Save; duplicate warning; print from an unsaved draft and from a saved recipe; shopping list from the panel and in the library.
- Library list, search and edit; backup export; import with Skip and as copies; delete all with counts; session-only mode (IndexedDB identical before and after reload).
- Zero network: 45 requests from extension pages and the service worker, all to the extension itself, 0 external. 0 errors on extension pages and the service worker.
- Keyboard order with a visible focus ring (panel, library); 200% zoom at 360 px with no horizontal scrolling (panel, library, options, print); dark mode.

## Live sites (ingredients / steps)
| Site | Status | Result |
|---|---|---|
| smittenkitchen.com | OK | 14 ingredients in 4 groups / 8 steps (page layout) |
| joshuaweissman.com | OK | 13 / 7 (ingredients from JSON-LD; steps from the page, because the site's runtime JSON-LD flattens nested size options into repeated steps) |
| bbcgoodfood.com | OK | 6 / 5 |
| recipetineats.com | OK | 16 / 10 |
| loveandlemons.com | OK | 11 / 6 |
| kingarthurbaking.com | OK | 12 / 12 |
| allrecipes.com, simplyrecipes.com, seriouseats.com, budgetbytes.com, cookieandkate.com, sallysbakingaddiction.com | Blocked | HTTP 403 challenge |

Counts alone don't prove correctness; the line-by-line review below is still required.

## Bug fixed
Smitten Kitchen page-layout extraction returned 7 ingredients (one was a heading) and 1 bogus step. Fixed generically in `src/extraction/dom.ts` and `src/extraction/domtext.ts` (underlined and "Label (note)" headings, lone quantity lines, labeled ingredient options, labeled tips and variations to notes, steps stop at the content area and footer, title not taken from the first group heading). New synthetic fixture `tests/fixtures/extraction/underline-runin-variants.html` and unit test.

## Remaining issues
1. The 6 blocked sites are unverified in a real, non-headless browser.
2. The empty-JSON-LD fallback is proven only by a fixture (the live Joshua Weissman page no longer needs it).
3. Smitten Kitchen's title appears in lowercase, as on the page heading.
4. Scaled amounts switch from Unicode fractions (1 ½) to plain text (3/4); values are correct.
5. RecipeTin Eats lines contain "(, minced)", copied from the site's own data.

## Needs a person in Google Chrome
1. Load `dist/` with **Load unpacked**; confirm the extension card shows no errors.
2. Click the toolbar icon on Smitten Kitchen and Joshua Weissman; compare every group and step against the page.
3. Retest the 6 blocked sites in normal browsing; record a challenge as blocked.
4. Print preview and Save as PDF on A4 and Letter; no clipped steps.
5. Restart the browser: saved recipes persist; an unsaved draft is gone after closing the panel.
6. Switch tabs with the panel open: the "You switched tabs" notice appears and **Read current tab** works.
7. Check announcements with VoiceOver.
