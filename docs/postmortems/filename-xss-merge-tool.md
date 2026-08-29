# Post-mortem: filename-based DOM XSS in Merge PDF

**Status:** fixed, validated. Not yet committed to git (working-tree change in `js/merge.js`).

## Summary

The Merge PDF file-list renderer built each row's HTML via a template string that interpolated `File.name` directly into `innerHTML`, including inside a `title="..."` attribute. A crafted filename could break out of that attribute and inject live DOM elements (e.g. `<img onerror=...>`) that execute arbitrary JS in the page. Fixed by assigning the filename through `Node.textContent` / `Element.title` instead of string-interpolated `innerHTML`. Found and fixed in the same session via manual code review and live reproduction in a browser tab, no ticket system on this repo.

## Symptom

Not customer-reported — found by manual code review reading `render()` in `js/merge.js`, then confirmed live in a running instance of `tools/merge.html`.

## Root cause

`render()` in `js/merge.js` (pre-fix, formerly lines 67–76) built each file-list `<li>` like this:

```js
li.innerHTML = `
  <span class="order">${index + 1}</span>
  <span class="name" title="${entry.file.name}">${entry.file.name}</span>
  ...
`;
```

`entry.file.name` comes straight from `File.name`, which is attacker-controllable: any OS that permits `"`, `<`, `>` in filenames (macOS, Linux) lets a user pick — or be handed — a file named e.g.:

```
x"><img src=x onerror="...">.pdf
```

Because the value is concatenated into a template string that is then assigned to `.innerHTML`, the browser parses it as markup, not text. The `"` closes the `title` attribute early, and the rest of the string becomes real HTML — including an `<img>` tag with an `onerror` handler, which the browser executes once the (deliberately invalid) `src` fails to load.

## Why it produced the symptom

The XSS payload lives entirely in data the user controls at the moment they add a file (drag-drop or file picker) — no server round-trip needed, since this is a fully client-side static tool. The injected `<img>`'s `onerror` fires asynchronously (on the next task tick, after the failed image load), which is why a naive synchronous check right after adding the file looks like the payload didn't fire — it needs one tick to resolve.

## Fix

`js/merge.js`, `render()`: the `<li>` skeleton is still built with `innerHTML` (safe — it contains no user data, only `index`, `formatSize(entry.file.size)` which is numeric, and `entry.id` which is an internal numeric counter), but the `.name` span is left empty in the template and populated afterward via:

```js
const nameSpan = li.querySelector(".name");
nameSpan.textContent = entry.file.name;
nameSpan.title = entry.file.name;
```

`textContent` and the `.title` DOM property both treat the value as plain data, never as markup, so there is no attribute or tag boundary to break out of. This fixes the mechanism, not just the observed payload — any filename content is now inert regardless of what characters it contains.

## How it was found

Found via a manual end-to-end review of `js/merge.js`, tracing `render()`'s use of `innerHTML` and noting `File.name` is attacker-controllable. Confirmed live by reproducing it in a running browser tab:

1. Loaded `tools/merge.html` in a real browser tab (local `http-server` on port 8420).
2. Built a minimal valid PDF in-page and wrapped it in a `File` named `x"><img src=x onerror="window.__xssFired=true">.pdf`.
3. Dispatched a `drop` `DragEvent` carrying that file onto the dropzone.
4. Immediately after: `imgTagsInStrip: 2`, `titleAttrLength: 1` — confirmed the attribute broke early and two `<img>` elements were injected (payload appears both in the `title` attribute and the visible name text).
5. `window.__xssFired` was `false` immediately after (async — image `onerror` hadn't resolved yet), then `true` one second later. That's the single experiment that confirmed live code execution, not just malformed markup.

Post-fix, the same repro was re-run: `imgTagsInStrip: 0`, `nameSpanText` equal to the raw literal string, `xssFired` stayed `false`. Confirms the payload is now inert.

## Why it slipped through

New code — this is the first implementation of the Merge PDF tool, written in this same session, and shipped with the bug already present. No prior review pass had happened before this review; this is the review that caught it before the code was ever pushed as "done."

## Validation

- Pre-fix repro (steps above) confirmed the exploit fires.
- Post-fix, identical repro confirmed `imgTagsInStrip: 0` and `xssFired` stays `false`.
- Only tested in one browser (Chrome) and one entry path (drag-drop). Not retested against the file-picker (`change` event) path, though it goes through the same `render()` function and is not expected to differ — both call `addFiles()` → `render()`.

## Action items

None — the fix addresses the mechanism (unescaped `innerHTML` interpolation of user data) directly, and no other renderer in this codebase currently interpolates user-controlled strings into `innerHTML` (checked: `index.html` and `tools/merge.html` contain only static markup; `js/merge.js`'s other `innerHTML` uses — the icon SVGs, the `<li>` skeleton — take no user input).
