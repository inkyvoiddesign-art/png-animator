The first desktop build of PNG Animator.

Drop in one transparent PNG, pick a motion preset, and get a looping animation
out — as an alpha PNG sequence, a WebM with transparency, or an MP4.

## Download

**[PNG-Animator-Setup-1.0.0.exe](../../releases/download/v1.0.0/PNG-Animator-Setup-1.0.0.exe)** — Windows 10/11, 64-bit, 99 MB

Per-user install, so there's no administrator prompt. You pick the folder, and
it adds Start Menu and desktop shortcuts.

> **SmartScreen will warn you the first time.** The installer isn't code-signed
> — that needs a paid certificate. Choose **More info**, then **Run anyway**.

## What it does

- **Eight motion presets** — rain, vertical and horizontal scroll, idle bob,
  breathe, sway, float and pop, each with its own controls
- **Seeded and deterministic** — save a look, reload it later, get the identical
  animation back frame for frame
- **Real alpha throughout** — the preview, the PNG sequence and the WebM all
  keep transparency
- **Slicing** — cut one sheet into a grid or auto-detect separate shapes, and
  animate each piece independently
- **Seam check** — shows the loop's wrap point and warns when your edges are too
  opaque to tile cleanly
- **Saved looks** — stored locally with preset, parameters, seed, canvas,
  duration, fps and easing; exportable as JSON

## Exporting

| Format | Alpha | Notes |
| --- | --- | --- |
| PNG sequence | Yes | Numbered frames written straight to a folder you choose |
| WebM · VP9 | Yes | Good for web and OBS. **Not** for DaVinci Resolve |
| MP4 · H.264 | No | Flattened onto your background; plays anywhere |

For Resolve or Premiere, export the PNG sequence and run the ffmpeg command the
app hands you — it comes with the real paths already filled in:

```
ffmpeg -framerate 30 -i name_%04d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le name.mov
```

## Privacy

The app never connects to anything. No telemetry, no accounts, no update check.
Your images never leave your machine.

## Building it yourself

```
npm install
npm start        # run it
npm run dist     # build the installer into dist/
```
