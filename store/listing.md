# Chrome Web Store listing

Paste each block into the matching field of the [developer dashboard](https://chrome.google.com/webstore/devconsole). Every statement here describes the shipped extension; update it if the extension changes.

## Store listing tab

**Name** (from the manifest): Recipe Pocket

**Summary** (from the manifest, 132 characters or fewer):

```text
Read the recipe on the current page in a clean view. Save locally, scale, convert, list and print. No account, no analytics.
```

**Primary category:** Lifestyle > Household. Confirm that the dashboard still offers it; choose the closest option if not.

**Language:** English

**Detailed description:**

```text
Recipe Pocket pulls the ingredients and steps out of a recipe page and shows them in a clean side panel, next to the page. Click the toolbar icon on a recipe and start cooking.

WHAT YOU CAN DO
• Read the recipe without the ads, pop-ups and long introductions.
• Change the servings. Amounts follow, with exact fractions.
• Convert between US and metric units.
• Cook one step at a time in large text, with ingredients to check off.
• Print a clean page or save it as a PDF.
• Save recipes to a library you can search by title, tag or ingredient.
• Build shopping lists sorted by aisle.
• Edit recipes, add notes, and organize them into collections.
• Export a backup file whenever you like.

PRIVATE BY DESIGN
• No account, no analytics and no ads.
• The extension makes no network requests of its own.
• It reads a page only when you click its icon.
• Saved recipes stay in your browser on this device. Nothing is saved until you choose Save.

WHAT TO KNOW
Recipe pages vary, so reading a recipe can be imperfect. Check amounts and steps against the original page before you cook. Recipes remain the property of their publishers, and Recipe Pocket keeps a link to the source. Some sites block extensions or automated reading, and Recipe Pocket does not bypass paywalls or bot challenges.

Recipe Pocket is open source under the MIT license:
https://github.com/elisamuel40/recipe-pocket
```

**Store icon:** already in the ZIP (`icons/icon128.png`). Upload `dist/icons/icon128.png` if the dashboard asks for it.

**Screenshots** (1280x800), in this order, from `store/assets/`:

1. `screenshot-1-reader.png`
2. `screenshot-2-scale.png`
3. `screenshot-3-library.png`
4. `screenshot-4-list.png`
5. `screenshot-5-cook.png`

**Small promo tile** (440x280): `store/assets/promo-small-440x280.png`

**Marquee promo tile** (1400x560): `store/assets/promo-marquee-1400x560.png`

**Homepage URL:** https://elisamuel40.github.io/recipe-pocket/

**Support URL:** https://github.com/elisamuel40/recipe-pocket/issues

**Mature content:** Off

## Privacy practices tab

**Single purpose:**

```text
Recipe Pocket reads the recipe on the page the user selects and lets the user view, adapt, save and print it locally.
```

**activeTab justification:**

```text
Grants temporary access to the current tab only when the user clicks the toolbar icon, so the extension can read the recipe on that page. It gives no access to other tabs and no background access.
```

**scripting justification:**

```text
After the user clicks the toolbar icon, injects the extension's own packaged content script into the current tab to extract the recipe. No remote code is used, and nothing is injected without that click.
```

**sidePanel justification:**

```text
Shows the recipe in Chrome's side panel next to the source page, which is the extension's main reading and cooking view.
```

**Remote code:** No, I am not using remote code.

**Data usage: what the extension handles.** Check **Website content** only. Google's user data FAQ says local processing counts as handling. The extension reads recipe text from the page the user selects and stores it on the device if the user chooses Save.

**Data usage: certifications.** Check all three. The extension does not sell or transfer data, does not use it for unrelated purposes, and does not use it for creditworthiness or lending. The Limited Use statement is in the privacy policy.

**Privacy policy URL:** https://elisamuel40.github.io/recipe-pocket/privacy.html

## Distribution tab

**Visibility:** Public

**Pricing:** Free

**Regions:** All regions

## Test instructions for the reviewer

```text
No account or login is needed.

1. Open https://smittenkitchen.com/2010/04/homemade-pop-tarts/ and click the Recipe Pocket toolbar icon. The side panel opens.
2. On the welcome screen, click "Read recipe". The ingredients and steps appear.
3. Change Servings, then choose Metric under Units. Ingredient amounts update.
4. Click Save, then Library, to see the saved recipe. Saved data stays in IndexedDB on the device.
5. Disconnect from the internet and open the library again. It still works, because the extension makes no network requests.
6. In Settings, use "Delete all local data" to remove everything.

The extension reads a page only after the toolbar click, and its content security policy sets connect-src to 'none'.
```
