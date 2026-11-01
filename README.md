# Recipe Pocket — open-source Chrome extension build package
Working name; trademark availability not checked. Prepared October 31, 2026.

**Status:** version 0.1.0 developer build. Install it with Chrome's *Load unpacked* option: see [docs/install.md](docs/install.md). Real-browser QA results: [qa/REPORT.md](qa/REPORT.md).

This started as an implementation handoff. The extraction probe is executable research, not end-to-end app validation. No account, analytics, backend, subscription, or developer-held recipe data. Product UI lives inside Chrome. GitHub Pages hosts only public documentation, privacy policy and installation guidance.

## Read in order
1. PRD.md — scope, behavior and acceptance requirements
2. ARCHITECTURE.md — implementation contracts and privacy boundaries
3. AGENTS.md — agent execution instructions and work breakdown
4. TESTING.md and site-probe-results.json — evidence and release gates
5. docs/privacy.md, docs/terms.md — publication drafts
6. RELEASE.md — open-source and GitHub Pages deployment

All public documents are drafts until the built extension has been audited against them. Owner identity and support URL are release-blocking placeholders. All premium-equivalent product capabilities are in scope; video import remains a research gate, not a promise of compatibility with every social platform. Audio/video speech recognition is not implemented yet ([docs/video-gate.md](docs/video-gate.md)).

## Develop
```
npm ci
npm run check   # typecheck, unit tests, build, dist audit
npm run e2e     # real-browser tests (Playwright Chromium)
```
Load `dist/` with **Load unpacked** in `chrome://extensions`.
