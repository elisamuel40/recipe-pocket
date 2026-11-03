Developer build of Recipe Pocket, a Chrome extension that reads, saves, scales, converts and prints recipes on your device. No accounts, no network requests, no telemetry.

**This build is not on the Chrome Web Store.** You install it in developer mode.

## Install
1. Download [`recipe-pocket.zip`](https://github.com/elisamuel40/recipe-pocket/releases/latest/download/recipe-pocket.zip) and unzip it into a folder you will keep.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

To update, replace the folder contents with the new build, then click the reload icon on the extension card. See the [install guide](https://elisamuel40.github.io/recipe-pocket/install.html) for details.

To verify the download, run `shasum -a 256` on the versioned ZIP and compare the result with its `.sha256` file.

## Permissions
`activeTab`, `scripting` and `sidePanel` only. The extension reads a page only when you click its toolbar icon.

## Known limits
- Audio and video speech recognition is not implemented ([details](https://elisamuel40.github.io/recipe-pocket/video-gate.html)). Transcript and caption import works.
- Some sites block automated testing and were not verified in a real browser; see [`qa/REPORT.md`](https://github.com/elisamuel40/recipe-pocket/blob/main/qa/REPORT.md).
