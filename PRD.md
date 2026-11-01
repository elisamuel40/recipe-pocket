# Product requirements
## Purpose and constraints
Help a home cook read, save, adapt and cook a recipe from the current Chrome tab without distractions. The product is a Manifest V3 desktop Chrome extension, not a hosted web app. All product features are free and open source. No tracking, telemetry, usage counters, crash reporting, accounts, cloud sync, server extraction or remote AI. “No information kept” means no information held by the developer; recipes are stored on the user's device only after Save. Offer a session-only mode that writes neither recipes nor preferences to persistent storage.

## Public reference and independent implementation
Public descriptions at https://help.justtherecipe.com/article/4-what-is-premium and https://apps.apple.com/us/app/just-the-recipe-cook-smarter/id1598423213 identify unlimited saving, scaling, unit conversion, printing/PDF and video importing. Earlier help also lists priority support. Research summarizes behavior only: do not copy branding, UI assets, source code, private APIs, wording or proprietary extraction rules. This is independent implementation from public requirements; a formal legally supervised clean-room process has not occurred. Record source provenance for contributions. Preserve recipe author and original link; do not distribute scraped recipe collections.

## Feature coverage
| ID | Capability | Required behavior / acceptance |
|---|---|---|
| R01 | Extract current page | Toolbar action opens side panel and reads only invoked tab. Title, ordered ingredient groups, ordered instruction groups, yield, times and source are preserved. Missing data is visibly missing, never fabricated. |
| R02 | Multiple recipes | Show candidate title and section preview; user chooses. Never combine separate recipes automatically. |
| R03 | Unlimited saving | No product-imposed recipe count cap; device quota still applies. Explicit Save, duplicate source detection, edit/delete, search, collections, tags and notes. Failed writes leave existing records intact. |
| R04 | Serving adjustment | Fraction-aware rational arithmetic; scale ingredient quantities from immutable original values, support ranges and reset. Unknown units remain readable. Never scale oven temperature, time, pan size or embedded package size. |
| R05 | Unit conversion | Mass-to-mass and volume-to-volume conversions; explicitly choose US customary versus metric. Volume-to-mass only with a documented ingredient-specific density and user confirmation. Preserve original line and show approximations. No universal cups-to-grams factor. |
| R06 | Print/PDF | Local print view with attribution, groups, notes option, selected servings and units. Browser print dialog provides Save as PDF; no upload or conversion service. |
| R07 | Manual recipes | Create, edit and duplicate; ingredient and instruction group editing; local image file optional. No remote image fetches in reader. |
| R08 | Cooking mode | Large adjustable text, light/dark/system theme, ingredient checks, current-step focus, keyboard access; session progress cleared on close unless explicitly saved. |
| R09 | Shopping lists | Combine selected recipes, retain source association, editable aisle categories, checks and manual entries. Merge only matching normalized ingredient/unit/preparation keys; ambiguous items stay separate. |
| R10 | Local backups | Versioned JSON export/import; preview count/conflicts, size limits, schema validation, atomic commit and local migration. Manual file transfer replaces cloud sync. |
| R11 | Video recipes | Full-scope feature: user-selected local audio/video and user-supplied transcripts processed entirely on device. Caption text from an invoked page can be imported. Separate local speech recognition worker with bundled licensed model. Review transcript-derived quantities and steps before Save. Cancel frees media buffers. |
| R12 | Social video links | Use already accessible captions/recipe text where available. No DRM, login or download restriction bypass. For inaccessible audio, explain limitation and offer transcript/local-file import. Universal TikTok/Reels/Shorts parity is not verified and cannot be claimed. |
| R13 | Privacy controls | Session-only reading by default; Save is explicit. Delete one, delete all, export; explain local backups and browser/OS behavior. No automatic diagnostics or uninstall feedback URL. |
| R14 | Support | Bundled help and troubleshooting; optional GitHub issues with explicit public-disclosure warning. Priority human support is a service, not software parity, and is not promised. |

## Interaction specification
First launch: explain “Reads this page when you ask. Saves only on this device.” Actions: Read recipe, Library, Settings. Reader states: loading, ready, partial, multiple candidates, restricted page, no recipe, extraction failure. Ready shows source, title, metadata, servings/units, ingredients, steps, Save, Print and Add to list. Partial state highlights missing sections and offers manual selection/editing. Close does not save automatically.

Library: local search across title/tags/ingredients; collection filter; edit/export/delete. Empty state explains how to read a tab. Settings: theme, font, session-only option, backup/import, delete all, privacy and licenses. Destructive delete-all requires confirmation with item count; cancellation preserves all records. Changing tabs must never silently replace a recipe being edited. Include accessible labels, visible focus, logical heading order, non-color status cues and usable 200% zoom. Target WCAG 2.2 AA, verified by audit rather than claimed by default.

## Quality targets and scope gates
Text extraction target under 1 second after loaded-page invocation for fixture DOM up to 2 MB; hard timeout 5 seconds with recovery. Library search target under 200 ms at 1,000 synthetic recipes on a documented baseline laptop. No developer endpoint requests under any workflow. Offline saved library, edit, scale, convert and print work with network disconnected. Browser minimum/version and video model footprint must be selected and measured before release. English quantity parsing first; other scripts retained verbatim with unsupported parsing indication.

Core release and complete-scope release are separate milestones. Do not mark all-premium-equivalent scope complete until R11 is implemented and local video fixtures pass. No subscriptions or payment processing are planned. Excluded: a hosted product, cloud account/sync, recipe redistribution platform, nutrition estimation, generated recipes and unrestricted video download.
