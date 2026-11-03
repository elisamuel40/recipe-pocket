---
layout: default
title: Installation
---
# Install Recipe Pocket in developer mode

{% if site.chrome_store_url %}The easiest way to install Recipe Pocket is from the [Chrome Web Store]({{ site.chrome_store_url }}). You can also install a build with Chrome's **Load unpacked** option, as described here.{% else %}Recipe Pocket is not on the Chrome Web Store yet. You can install a development build with Chrome's **Load unpacked** option.{% endif %}

## Option A: download a release ZIP
1. [Download `recipe-pocket.zip`](https://github.com/elisamuel40/recipe-pocket/releases/latest/download/recipe-pocket.zip). This link always gets the latest version.
2. Optional: to verify the download, get the versioned ZIP and its `.sha256` file from the [GitHub Releases](https://github.com/elisamuel40/recipe-pocket/releases) page and compare the checksums.
3. Unzip it into a folder you will keep (Chrome loads the extension from that folder).
4. Open `chrome://extensions` in Chrome.
5. Turn on **Developer mode** (top-right corner).
6. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
7. Pin Recipe Pocket from the puzzle-piece menu so the icon stays visible.

## Option B: build from source
Requires Node.js 24 or later.
1. `git clone https://github.com/elisamuel40/recipe-pocket.git && cd recipe-pocket`
2. `npm ci`
3. `npm run build`
4. Load the `dist/` folder with **Load unpacked** (steps 4–7 above).

## Use it
Open a recipe page, then click the Recipe Pocket icon. The side panel reads that page only when you click. Nothing is saved until you choose **Save**.

## Update or remove
- To update, [download the latest ZIP](https://github.com/elisamuel40/recipe-pocket/releases/latest/download/recipe-pocket.zip), replace the folder contents with its files and click the reload icon on the extension card in `chrome://extensions`.
- Back up your recipes (Settings → Export backup) before removing the extension. Removing it deletes its local storage.

GitHub Pages hosts these documents, not the extension runtime.
