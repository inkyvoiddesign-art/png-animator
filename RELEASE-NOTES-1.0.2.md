MP4 export is fixed. It now writes a constant frame rate, and it no longer
drops frames.

## Download

**[PNG-Animator-Setup-1.0.2.exe](../../releases/download/v1.0.2/PNG-Animator-Setup-1.0.2.exe)** — Windows 10/11, 64-bit, 99 MB

Per-user install, so there's no administrator prompt. Installing over an
earlier version keeps your saved looks — they live in your user profile, not
the program folder.

> **SmartScreen will warn you the first time.** The installer isn't code-signed
> — that needs a paid certificate. Choose **More info**, then **Run anyway**.

## Fixed

**MP4 export produced a file editors wouldn't take.** A 30fps export measured
about 29.5fps, at an interval that wandered from frame to frame, so DaVinci
Resolve and Premiere rejected it as variable frame rate. Worse, and not
previously known: it was also **losing frames**. A 90-frame export arrived with
80 of them, including one stall where a third of a second passed and a single
frame came out the other side.

The cause was how the frames were handed to the encoder. Each one was stamped
with the wall-clock moment it happened to be submitted, and nothing ever said a
frame belonged at a particular point on the timeline. Export now states the
presentation time for every frame outright, so they land exactly one frame
apart and nothing is dropped.

Measured on the same 1080×1920, 90-frame, 30fps export:

| | Before | After |
| --- | --- | --- |
| Reported frame rate | 353/12 (≈29.42) | **30/1** |
| Average frame rate | undeterminable | **30/1** |
| Frames in the file | 80 of 90 | **90 of 90** |
| Duration | 3.020742s | **3.000000s** |
| Distinct frame intervals | 6, including a 374ms gap | **1** |

MP4 exports now import into Resolve and Premiere directly. The PNG sequence
remains the better choice when you need transparency, since MP4 has none.

## Still known

**WebM has the same two faults** — variable frame rate, and dropped frames. It
is unchanged in this release. Fixing it the same way would cost transparency,
which is the main reason to pick WebM here, so it needs a different approach.

**For editing work with alpha, use the PNG sequence.** The app gives you an
ffmpeg command with the real paths already filled in:

```
ffmpeg -framerate 30 -i name_%04d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le name.mov
```

That produces a ProRes 4444 .mov with the alpha intact, which Resolve imports
without complaint.

## Under the hood

Encoding moved from `MediaRecorder` to the `WebCodecs` `VideoEncoder`, which
accepts an explicit timestamp per frame. Encoded chunks are wrapped in an MP4
container by [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT). No
external binary, and the installer is the same size as before.

## Privacy

The app never connects to anything. No telemetry, no accounts, no update check.
Your images never leave your machine.
