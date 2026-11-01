---
layout: default
title: Video import status
---
# Video import status

**Summary:** You can turn a video's captions or transcript into a draft recipe on your device. Recipe Pocket can't yet turn speech in an audio or video file into text. This is a documented blocker for requirement R11 (video recipes), not a dropped feature.

Last reviewed: October 31, 2026.

## What works today

- **Paste captions or a transcript.** The importer removes SubRip (SRT) and WebVTT timing, cue numbers, tags and repeated rolling-caption lines. It then sorts lines into ingredients, steps and "lines not sorted".
- **Choose a local `.txt`, `.srt` or `.vtt` file** up to 2 MB. Recipe Pocket reads the file on your device and doesn't upload it.
- **Review before saving.** Every draft says that transcript-derived quantities, ingredients and steps can be misheard or missing. The importer never adds a quantity, ingredient or step that isn't in your text. It leaves lines it can't sort for you to place.
- **Cancel** clears the pasted text, the file selection and the draft.

## What doesn't work yet

- **Speech recognition for audio or video files is not implemented.** If you choose an audio or video file, Recipe Pocket explains this, doesn't read the file, and suggests pasting captions instead.
- **No universal social-video support.** Recipe Pocket doesn't claim to work with every TikTok, Instagram Reels or YouTube Shorts video. It uses only captions or recipe text that the page already shows you. It doesn't download videos or get around logins, DRM (digital rights management) or download restrictions.

## Why speech recognition isn't available yet

Recipe Pocket promises zero network use. No cloud speech service is allowed, and no model download at runtime. A speech model would have to ship inside the extension. That approach looks possible, but these release gates are still open:

1. **Package size.** The smallest useful model adds about 40 MB (Whisper tiny.en, 8-bit ONNX) plus about 12 MB of runtime. A multilingual base model adds about 80 MB or more. That's within the Chrome Web Store's 2 GB limit, but it's 100 times larger than the rest of the extension.
2. **Security policy change.** WebAssembly (WASM) inference needs `'wasm-unsafe-eval'` in the extension's content security policy (CSP). Chrome allows this for Manifest V3 extensions, but the project policy says to change the CSP only after tested justification.
3. **No measurements yet.** Nobody has measured speed and memory on a baseline laptop. Published browser benchmarks for Whisper are informal.
4. **Runtime loading under a strict CSP.** ONNX Runtime Web documents that its inlined workers may not work in CSP-restricted pages. Multithreading needs cross-origin isolation. Both must be shown to work with only local, bundled files.
5. **Third-party code review.** A dependency audit, license inventory and SBOM (software bill of materials) entry would be needed for the runtime and the model.

### Facts checked

| Item | Finding | Source |
|---|---|---|
| Whisper license | Code and model weights released under the MIT License | [openai/whisper](https://github.com/openai/whisper) |
| Model sizes | tiny 39 M parameters, base 74 M | [openai/whisper](https://github.com/openai/whisper) |
| tiny.en ONNX, 8-bit | Encoder about 10 MB, merged decoder about 31 MB | [onnx-community/whisper-tiny.en](https://huggingface.co/onnx-community/whisper-tiny.en/tree/main/onnx) |
| whisper.cpp models | tiny about 78 MB (q5_1 about 32 MB); base about 148 MB (q5_1 about 60 MB) | [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/main) |
| Transformers.js | Apache-2.0; runs ONNX Runtime with WASM or WebGPU; supports local-only model paths | [huggingface/transformers.js](https://github.com/huggingface/transformers.js) |
| ONNX Runtime Web | MIT; SIMD threaded WASM binary about 12 MB (v1.24.3) | [License](https://github.com/microsoft/onnxruntime/blob/main/LICENSE), [package files](https://app.unpkg.com/onnxruntime-web@1.24.3/files/dist) |
| whisper.cpp | MIT; has a WASM build | [License](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE) |
| CSP | Manifest V3 allows `'wasm-unsafe-eval'`; `'unsafe-eval'` isn't allowed | [Chrome CSP docs](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) |
| Inlined workers | May not work in CSP-restricted environments | [ONNX Runtime deploy docs](https://onnxruntime.ai/docs/tutorials/web/deploy.html) |
| Threads | Need cross-origin isolation; extensions can opt in; not available in service workers | [Chrome cross-origin isolation](https://developer.chrome.com/docs/extensions/develop/concepts/cross-origin-isolation) |
| Store package limit | 2 GB maximum | [Chrome Web Store publishing](https://developer.chrome.com/docs/webstore/publish) |
| Code readability | Minified code allowed; obfuscated code not allowed | [Code readability policy](https://developer.chrome.com/docs/webstore/program-policies/code-readability) |
| Offscreen documents | One at a time; reasons include `WORKERS` and `BLOBS` | [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen) |
| Cancellation | `Worker.terminate()` stops a worker immediately | [MDN Worker.terminate()](https://developer.mozilla.org/en-US/docs/Web/API/Worker/terminate) |

Not confirmed: base-model ONNX sizes, whisper.cpp WASM binary size, whether `terminate()` reliably frees all WASM memory, and Chrome Web Store review treatment of large WASM files.

### Alternative considered: Chrome built-in speech recognition

Chrome 139 added on-device speech recognition for the Web Speech API ([New in Chrome 139](https://developer.chrome.com/blog/new-in-chrome-139)). It isn't a fit today:

- Language packs download through `install()`, which breaks the zero-network baseline on first use.
- `processLocally` is marked experimental ([MDN](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally)).
- Not confirmed: whether it can transcribe a decoded file's audio track locally, rather than a live microphone.

## Implementation plan

Do these in order. Each step ends with a visible result.

1. **Prototype outside the release build.** Build a separate local page with Transformers.js and Whisper tiny.en (8-bit ONNX), single-threaded WASM, all files local, `env.allowRemoteModels = false`. Done when one 60-second synthetic clip transcribes with the network disabled.
2. **Measure.** On a documented baseline laptop, record package size, peak memory, time per audio minute, and time to first output for 1, 5 and 15 minute clips. Repeat with WebGPU and with threads in a cross-origin-isolated offscreen document. Done when the table below is filled in.
3. **Decide the model.** Pick tiny.en or base based on measurements and accuracy on licensed synthetic fixtures. Record the license and attribution in `THIRD_PARTY_NOTICES.md`.
4. **Integrate behind the gate.**
   - Add an offscreen document (reason `WORKERS`) that hosts a dedicated worker.
   - Decode the user-selected file with `AudioContext.decodeAudioData`, resample to 16 kHz mono, and process it in chunks.
   - Add a progress indicator and a Cancel button. Cancel calls `worker.terminate()` and drops all audio buffers.
   - Add `'wasm-unsafe-eval'` to the CSP with a written justification.
   - Set `isLocalSpeechRecognitionAvailable()` to return `true`.
   - Send the transcript text to the existing draft and review flow.
5. **Pass the video tests in `TESTING.md`.** Cover licensed synthetic audio and video, silence, noisy audio, unsupported codecs, cancellation, oversized files and missing quantities. Confirm no network requests with interception.

## Measurements still needed

| Measurement | Target | Result |
|---|---|---|
| Added package size (model and runtime) | Set before release | Not measured |
| Peak memory, 5-minute clip | Set before release | Not measured |
| Time per audio minute (WASM, single thread) | Set before release | Not measured |
| Time per audio minute (WebGPU) | Set before release | Not measured |
| Memory released after Cancel | Returns to baseline | Not measured |
| Word error rate on synthetic recipe fixtures | Set before release | Not measured |
| Network requests during transcription | Zero | Not measured |

## Release status

The core release can ship transcript and caption import. The complete-scope release must not be marked complete until on-device speech recognition passes the gate above.
