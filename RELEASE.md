# Open-source and GitHub Pages release
The user requested free GitHub Pages hosting and open source. Product remains a Chrome extension. Pages serves documentation and policies only; it cannot run privileged extension APIs or install the extension automatically.

## Prepared configuration
Public repository; MIT license for original project code/docs; docs/ as Jekyll source. GitHub Pages deployment workflow is supplied. No custom domain needed, no paid services, no backend. Repository: https://github.com/elisamuel40/recipe-pocket (owner: Eli S Sanchez). Docs site: https://elisamuel40.github.io/recipe-pocket/.

1. Choose repository owner/name, working product name, copyright owner and public contact. Replace all bracketed placeholders.
2. Initialize public repo with this package; add extension source only after implementation. Keep scratch HTML and user data out of git.
3. In repository Settings → Pages choose GitHub Actions. Enable Actions and run the Pages workflow on main. Confirm privacy URL publicly accessible without sign-in.
4. Audit the deployed pages for external assets, analytics and accidental recipe content. GitHub infrastructure may retain logs; developer adds no analytics. Free hosting is not equivalent to zero third-party infrastructure retention.
5. Build extension reproducibly from locked dependencies; attach versioned ZIP, SHA-256 checksum and SBOM to a GitHub release. Do not upload this specification ZIP to the Chrome Web Store as an extension.
6. User installation during development: download built extension, unzip, open chrome://extensions, enable Developer mode, Load unpacked. Ordinary distribution through Chrome Web Store requires separate publisher setup/review; free Pages hosting does not imply free store registration.
7. Store submission: single purpose is reading and managing recipes locally. Explain activeTab/scripting/sidePanel separately. Declare locally handled website content accurately and no developer collection or sale. Link published privacy policy. Provide reviewer steps using both mandatory URLs, offline library and deletion.
8. Release only after TESTING.md gates. Tag versions, maintain changelog, review dependency/model licenses, document limitations. Rollback via corrected extension release; keep backup schema backward-compatible where possible.

## Publish a developer build
1. Set the same new version in `package.json`, `package-lock.json` and `src/manifest.json`, and merge the change to main.
2. Create and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `.github/workflows/release.yml` runs `npm run package` and publishes the release. The stable download link, https://github.com/elisamuel40/recipe-pocket/releases/latest/download/recipe-pocket.zip, then serves the new build.

## Public listing draft
Recipe Pocket turns the recipe on your current page into a readable cooking view. Save recipes locally, organize collections, adjust servings, convert supported measurements, make shopping lists, and print or save a PDF. No account or analytics. All product data stays on your device. Site compatibility varies. Video features must be added to the listing only after their release gate passes.

## Sources verified for this handoff
- https://help.justtherecipe.com/article/4-what-is-premium
- https://apps.apple.com/us/app/just-the-recipe-cook-smarter/id1598423213
- https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://developer.chrome.com/docs/webstore/program-policies/privacy
- https://schema.org/Recipe

GitHub hosting/workflow references:
- https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
