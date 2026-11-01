# Test evidence and required validation
Executed October 31, 2026 (America/Puerto_Rico). Twelve public URLs fetched via curl; HTML parsed by independent Python standard-library probe. Initial Python-launched requests had DNS failures; direct curl requests succeeded or returned explicit HTTP blocking. Final JSON records the latter attempt. Raw HTML is kept only in scratch work and excluded from public deliverables.

Result: six Recipe objects with ingredient lists and instructions; Joshua Weissman has a Recipe object but zero ingredients/no instructions; Smitten Kitchen has no Recipe object; three domains returned HTTP 403 and King Arthur returned 406. These are HTTP/structured-data probes, NOT a working extension test, rendered-DOM test or manual correctness verification. “Candidate found” alone is not a pass. See site-probe-results.json for URLs, counts and response hashes.

## Required live browser matrix
Use all twelve URLs in JSON, including both supplied URLs. For each: open normally in Chrome; invoke extension; compare every ingredient/group and ordered step against the visible recipe; check title/yield/times/source; verify comments excluded; scale 0.5x and 2x; reset; save/restart/offline; print preview and PDF; delete. Record browser/build/version, date, status, expected versus actual and screenshot with no personal data. Never bypass bot challenges or paywalls. An inaccessible page is blocked, not passed.

Special cases: Smitten Kitchen must preserve pastry and filling alternatives and exclude lengthy comments. Joshua Weissman must fall through incomplete JSON-LD to the visible ingredient/instruction sections. BBC/Good Food: verify any redirect and final source attribution. Other six structured candidates must be reviewed for grouping and ordering; counts alone cannot establish correctness. Blocked domains require ordinary-browser retest.

## Automated cases
- JSON-LD array/@graph, @type array, malformed neighboring block, @id cycles, ItemList, nested HowToSection and multiple recipes.
- Empty Recipe with complete DOM fallback; no recipe; SPA navigation during request; repeated invocation; restricted chrome:// pages.
- Quantities: mixed/Unicode fractions, decimal comma ambiguity, ranges, package sizes, “to taste”, temperatures, units and unitless quantities. 1/3 × 3 = 1, reset after 100 transforms remains exact.
- Mass/volume dimensional checks; unknown density never converts cups to grams. US versus metric cup choice explicit.
- Duplicate imports, corrupted schema, prototype pollution, XSS payloads, 10 MB boundary, migration failures and quota exhaustion; existing data preserved.
- Network test starts after source tab finishes loading: monitor extension-origin/service-worker/worker requests through every feature. Expect zero external requests, including remote images, fonts, models, diagnostics and update pings initiated by extension. Chrome-managed update traffic is a separate boundary.
- Session-only workflow leaves IndexedDB/storage/cache unchanged after close/restart. Saved workflows persist only explicit records. Delete-all removes app stores. Exported files remain and UI explains this.
- Service worker termination, multi-tab stale results, concurrent edits, panel close, browser restart, lost permissions.
- Keyboard-only use, focus management, screen reader, 200% zoom, contrast, dark mode and long recipes; print A4/Letter with no clipped steps.
- Video: licensed synthetic audio/video, silence, noisy audio, unsupported codecs, cancellation, oversized file, missing quantities. Review draft required; no invented values; no network. Test baseline laptop memory and time before promising performance.

## Reproduction
Run python3 tools/probe.py from repository root with internet access. This is a dependency-free metadata probe, not the production parser. Network restrictions can change results. Preserve the dated original JSON and write reruns separately. Production team must add browser automation and application tests once implementation exists.
