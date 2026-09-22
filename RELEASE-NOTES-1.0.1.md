A layout fix. Everything else is unchanged from 1.0.0.

## Download

**[PNG-Animator-Setup-1.0.1.exe](../../releases/download/v1.0.1/PNG-Animator-Setup-1.0.1.exe)** — Windows 10/11, 64-bit, 99 MB

Per-user install, so there's no administrator prompt. Installing over 1.0.0
keeps your saved looks — they live in your user profile, not the program folder.

> **SmartScreen will warn you the first time.** The installer isn't code-signed
> — that needs a paid certificate. Choose **More info**, then **Run anyway**.

## Fixed

**Saved Animations was unreachable in detect slicing mode.** Switching Slicing
to *detect* adds a region-size control, a preview and two buttons to the left
column. On a smaller window that column needed more room than it had, and
because the window doesn't scroll, the Saved Animations panel was pushed past
the bottom edge with no way to get to it — so you couldn't save or load a look
without switching slicing back.

Three things changed:

- **The columns scroll when their contents don't fit.** Previously anything that
  overflowed was simply clipped.
- **Saved Animations keeps a minimum height.** It was the panel that gave up its
  space first, so it used to shrink to nothing before anything else moved.
- **The detect preview is capped.** It sized itself from the source image, so a
  tall PNG produced a preview several hundred pixels high — most of the overflow
  on its own. It now scales down and keeps its aspect ratio.

## Still known

MP4 export writes a variable frame rate — a 30fps export measures about 29.58fps
— so editors that expect constant frame rate, DaVinci Resolve among them, refuse
it. **Use the PNG sequence for editing work.** The app gives you an ffmpeg
command with the real paths already filled in:

```
ffmpeg -framerate 30 -i name_%04d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le name.mov
```

That produces a ProRes 4444 .mov with the alpha intact, which Resolve imports
without complaint. A proper fix for MP4 is planned for a later release.

## Privacy

The app never connects to anything. No telemetry, no accounts, no update check.
Your images never leave your machine.
