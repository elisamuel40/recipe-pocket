# Implementation team contract
Build from this package, independently of competitor internals. This file describes future team work; no parallel agents were used to author this package. Never mark an unrun check passed. Do not upload user pages or recipes to coding/AI services at runtime.

## Work sequence and ownership
1. Integrator: create extension skeleton, strict TypeScript, build/CI, manifest and message contracts. Deliver unpacked extension that opens side panel. Gate: no network or broad permissions.
2. Extraction owner: generic structured-data parser, fallback pipeline and site adapters only where necessary. Depends on contracts. Gate: complete and partial cases, two mandatory pages, synthetic malicious cases.
3. Domain owner: rational scaling, conservative unit conversions, schema, migrations/import/export and lists. Depends on contracts. Gate: arithmetic and transactional failure tests.
4. UI owner: implement reader/library/editor/settings/print/cook views, keyboard and screen-reader access. Depends on extraction and storage contracts. Gate: all R01–R10/R13 flows.
5. Media owner: local ASR/model licensing and package-size prototype; captions/transcripts and file import. Gate: measured memory/speed, no network, cancellation, human-reviewed output. If infeasible, document blocker; do not quietly drop video parity.
6. QA/privacy owner: independently run TESTING.md, inspect build and data flows, review store declarations and policy accuracy.
7. Release owner: replace public placeholders, finalize license attribution, tag, build archive, publish docs and prepare store submission.

Each task delivers changed files, tests executed, results, limitations and next dependency. Parallel work may begin only after interfaces are agreed. Integrator resolves shared contracts. No agent publishes to GitHub or Chrome Web Store without repository/store authorization. Never commit downloaded third-party page HTML or real user backups. Use original synthetic fixtures in the public repository.

## Definition of done
Requirements map to tests and passing artifacts. Twelve live domains manually checked in Chrome; blocked probe results resolved or explicitly listed as unsupported without asserting universal compatibility. Both supplied URLs must pass full recipe review. All-premium completion requires video gate. Reproducible build, zero-telemetry audit, policy consistency, dependency/license checks, accessibility review, storage recovery tests and reviewer installation instructions must pass.
