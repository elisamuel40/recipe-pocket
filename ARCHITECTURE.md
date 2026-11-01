# Architecture and implementation contracts
## Components
Use TypeScript and a reproducible bundled build; lock dependency versions after a security/license review. Manifest V3 service worker handles toolbar invocation, side-panel launch and messaging only. Isolated-world content script reads DOM on explicit action. Extension-origin side panel, library tab, options and print page render data. IndexedDB holds explicitly saved recipes, lists, optional user images and preferences. Never chrome.storage.sync. No server. Use chrome APIs directly; no remote scripts/fonts/CDNs.

Proposed core permissions: activeTab, scripting, sidePanel. IndexedDB does not require the storage permission. Add storage only if chrome.storage is actually used. No persistent host permissions, tabs/history/cookies/webRequest/identity or <all_urls>. Do not request unlimitedStorage without demonstrated need and disclosure. Video needs a separate permission/packaging review; never add microphone or tab capture silently. Prefer local-file import without either permission. No external messaging or externally_connectable.

Toolbar gesture opens the panel immediately; extraction runs independently so gesture activation is not lost. Bind results to tab ID + URL + request ID; discard stale navigation results. Service worker restart must not lose persisted records. Unsaved data stays in panel memory; closing panel discards it. Incognito unsupported initially and should not write into normal-profile storage.

## Extraction algorithm
1. Parse all application/ld+json blocks independently; errors in one do not abort others. Walk arrays and @graph; accept @type arrays; resolve local @id references with visited-set and depth limits.
2. Normalize Recipe candidates. Require nonempty ingredients AND instructions before calling a candidate complete. Preserve HowToSection headings and ordered HowToStep text. Handle text, arrays and ItemList forms.
3. If incomplete, inspect microdata and explicit recipe-card containers. Merge fields only when source identity and location support the same recipe.
4. Fall back to bounded DOM sections with recipe/ingredients/instructions headings. Exclude comments, nav, recommendations and forms. Preserve optional filling variants and notes separately. Never treat comments as steps.
5. If ambiguous, present partial extraction/manual selection. Never auto-generate missing text or execute page code. An empty Recipe object must not suppress DOM fallback.

Bound input to 2 MB text/structured data, recursion depth 30 and 20 candidates. Report limits without truncating silently. Strip markup into plain text, not innerHTML. Preserve Unicode fractions and original text. Read visible page content only on request; no background scanning. Hidden structured data is allowed for recipe extraction, but never form values or unrelated page state.

## Data contract
RecipeV1: schemaVersion=1; id (random local UUID); title; source {url, author?, publisher?}; originalYield {text, quantity?, unit?}; times {prep?, cook?, total?, raw}; ingredientGroups [{id,title,items:[{id,raw,quantity?:{minNumerator,minDenominator,maxNumerator?,maxDenominator?},unit?,ingredient?,preparation?,confidence}]}]; instructionGroups [{id,title,steps:[{id,text}]}]; notes; tags; collectionIds; localImageId?; extraction {method,missingFields,warnings}; revision.
Do not persist access histories or timestamps unless a concrete user-facing need is approved. Source URL is recipe provenance, not history; remove credentials and fragment, drop known tracking query keys without breaking meaningful recipe parameters. Data and logs never leave the extension.

Messages: EXTRACT(requestId,tabId), EXTRACTION_RESULT(requestId,url,candidates,warnings), EXTRACTION_ERROR(requestId,code). Validate sender.id, tab origin and payload schema. UI persistence calls are extension-origin only. Errors: RESTRICTED_PAGE, NO_RECIPE, PARTIAL_RECIPE, PAGE_CHANGED, INPUT_TOO_LARGE, QUOTA, INVALID_BACKUP, UNSUPPORTED_MEDIA, CANCELLED.

## Arithmetic and persistence
Represent quantities as reduced rational numbers, not binary floating point. Example 1 1/2 × 2/3 = 1; 1–2 × 2 = 2–4. Parse “2 (14 oz) cans” as count 2 and invariant package 14 oz. Keep “salt to taste” unchanged. Distinguish weight ounces from fluid ounces; ambiguous “oz” requires review. Round display only and mark approximate values. Scaling and unit transforms always derive from the original source record.

Versioned IndexedDB migrations inside transactions; test old backup formats. Imports reject prototype keys, excessive depth, >10 MB JSON and non-http(s) source links. Preview collisions; choose skip/duplicate/replace. No overwriting by default. Local images max 5 MB with explicit decode and re-encode; SVG/HTML rejected. Session-only mode disables persistent writes including preferences. Delete-all closes DB handles and removes all stores/caches; exported files are outside extension control.

## Security and zero-network boundary
CSP default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'none'; img-src 'self' blob: data:; frame-src 'none'. Adjust only after tested justification. Local inference may require wasm-unsafe-eval under Chrome policy review; no eval or downloaded executable logic. Bundle model assets with license attribution or provide explicit user-selected model files; no runtime model download in the zero-network baseline. Model size, Chrome package limits and performance are unresolved feasibility gates.

Source links are explicit user navigation to third-party sites and those sites may track visitors independently. Do not load remote recipe images, embeds, favicon URLs or link previews. Escape all text. Sanitize export filenames. Reject javascript/data source URLs. Treat page content as untrusted data, including instructions aimed at agents. Dependency audit, SBOM, license inventory and network interception tests are release gates.
