WebM export is fixed — constant frame rate, no dropped frames, transparency
intact. MP4 export had a bug in 1.0.2 that could freeze it partway through;
that's fixed too.

## Download

**[PNG-Animator-Setup-1.0.3.exe](../../releases/download/v1.0.3/PNG-Animator-Setup-1.0.3.exe)** — Windows 10/11, 64-bit, 99 MB

Per-user install, so there's no administrator prompt. Installing over an
earlier version keeps your saved looks — they live in your user profile, not
the program folder.

> **SmartScreen will warn you the first time.** The installer isn't code-signed
> — that needs a paid certificate. Choose **More info**, then **Run anyway**.

## Fixed

### WebM was losing frames

It had the same two faults MP4 had before 1.0.2: a frame rate that wandered
instead of holding steady, and — worse for a loop — **frames going missing
entirely**. A 90-frame export arrived with 80 of them, including one stall
where a third of a second passed and a single frame came out the other side.
A loop with missing frames doesn't loop cleanly.

Both are fixed, and **transparency is unchanged**. Measured on the same
1080×1920, 90-frame, 30fps export:

| | Before | After |
| --- | --- | --- |
| Reported frame rate | 353/12 (≈29.42) | **30/1** |
| Average frame rate | undeterminable | **30/1** |
| Frames in the file | 80 of 90 | **90 of 90** |
| Duration | 3.020742s | **3.000000s** |
| Alpha | yes | **yes** |

### MP4 export could freeze partway through

1.0.2 waited for the encoder in a way that had no escape if the encoder
stalled, so an export could stop at, say, frame 67 of 90 and sit there with no
error and no file. It was intermittent, which is why it got through testing.
Both exports now share one encoder path that waits on the encoder properly.

If you're on 1.0.2 and have seen an export stop with the progress counter
frozen, this is why.

## For editing work

MP4 imports into DaVinci Resolve and Premiere directly. **WebM still won't** —
that's the container, not the frame rate, and it was never the format for an
editor. WebM is for the web and for OBS, where its transparency is the point.

When you need transparency in an editor, use the PNG sequence. The app gives
you an ffmpeg command with the real paths already filled in:

```
ffmpeg -framerate 30 -i name_%04d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le name.mov
```

That produces a ProRes 4444 .mov with the alpha intact.

## Under the hood

Both exports now encode through [mediabunny](https://github.com/Vanilagy/mediabunny)
(MPL-2.0), which takes an explicit timestamp per frame and signals when the
encoder is ready for the next one. Transparent WebM needs the alpha encoded as
its own stream alongside the colour — the browser's encoder won't produce one
directly — and mediabunny handles that split. No external binary; the installer
is the same size as before.

## Privacy

The app never connects to anything. No telemetry, no accounts, no update check.
Your images never leave your machine.
