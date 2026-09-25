# PNG Animator

A desktop build of the PNG Animator tool: load a PNG, pick a motion preset, and
export a looping animation as an alpha PNG sequence.

## Running it

```bash
npm install
npm start
```

## Building the installer

```bash
npm run dist
```

The NSIS installer lands in `dist/` as `PNG-Animator-Setup-<version>.exe`. It
installs per-user (no admin prompt), lets the user pick the install directory,
and creates Start Menu and desktop shortcuts.

`npm run dist:dir` skips the installer and produces an unpacked app folder in
`dist/win-unpacked/` — quicker when you only want to smoke-test the packaged
build.

## Layout

```
src/
  index.template.html   page markup, fonts, and the x-dc component template
  app.dc.js             the animator logic — the file you actually edit
  vendor/               React, ReactDOM, JSZip, dc-runtime
  assets/fonts/         IBM Plex Mono / Sans, subset by the original export
electron/
  main.js               window, menu, protocol handler, IPC
  preload.js            the entire renderer-facing API surface
  store.js              window geometry and last-used folders, in userData
tools/
  build-renderer.js     composes renderer/ from src/
  make-icon.js          builds build/icon.ico from PNG2ANIMATION.png
  unpack-bundle.js      one-shot importer for a fresh Claude Design export
renderer/               generated — do not edit, do not commit
```

`app.dc.js` cannot be loaded as an external script: the dc-runtime reads the
component logic from the *text content* of the `<script type="text/x-dc">` tag.
`tools/build-renderer.js` inlines it, which is why `npm start` and `npm run dist`
both run that step first. Edit `src/`, never `renderer/`.

## Desktop behaviour

The renderer is served over a registered `png-animator://` scheme rather than
`file://`, so the page gets a real origin and `fetch`, `localStorage`, and font
loading behave exactly as they do in a browser.

Anything the page can do natively goes through `electron/preload.js`:

| Action | Behaviour |
| --- | --- |
| **File → Open Image** (`Ctrl+O`) | Native open dialog, reopening in the last folder used. Drag-and-drop and the in-page load buttons still work. |
| **PNG sequence** | Native folder picker. Frames are written straight to disk as they render — no zip, no holding the whole sequence in memory — into a subfolder named after the export. Explorer opens on the result, and the panel shows the ready-to-paste `ffmpeg` command with real absolute paths. |
| Window size and position | Restored on next launch, including maximised state. |

`app.dc.js` checks for `window.pngAnimatorNative` and falls back to the original
browser behaviour when it is absent, so the same source still runs as a plain
web page.

### Security posture

`contextIsolation` and `sandbox` are on, `nodeIntegration` is off. The renderer
gets no filesystem access beyond the preload API, and `write-frame` refuses any
directory the user did not choose through the picker in the current session.

### Network

The app makes exactly one kind of request: on launch it asks the public GitHub
releases API which release is latest, so it can tell you when a newer one
exists. It is sent from the main process, so the renderer's CSP stays closed
and the page itself never reaches the network. Nothing is sent but the request
— no identifier, no version number, no telemetry — and the only thing GitHub
learns is that some IP address asked. It fails silently when offline.

Turn it off under **Help → Check for Updates on Launch**, and the app makes no
network requests at all. Your images are never uploaded anywhere under any
setting.

## Re-importing from Claude Design

`tools/unpack-bundle.js` converts a Claude Design self-extracting HTML export
into this source tree — decoding the gzipped base64 manifest, writing the assets
out as real files, and splitting the x-dc logic into `src/app.dc.js`.

```bash
node tools/unpack-bundle.js "PNG Animator - blank start (offline).html"
```

Re-running it **overwrites `src/app.dc.js` and `src/index.template.html`**,
discarding the desktop integration patched into them. Diff before you commit.

## Notes

- PNG sequence is the only export. Video encoders were dropped in favour of it:
  the sequence keeps full alpha, imports into every editor, and converts to any
  codec you need. The panel shows a ready-to-paste `ffmpeg` ProRes 4444 command
  with real absolute paths after each export.
- The installer is unsigned, so SmartScreen will warn on first run. Signing
  needs a code-signing certificate; add it under `build.win.certificateFile`.
- Saved looks live in `localStorage` under the `png-animator://` origin, and
  survive upgrades. They are cleared only if you wipe the app's user data.
