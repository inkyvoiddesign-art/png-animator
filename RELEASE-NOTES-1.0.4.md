Seven new motion presets, including one where you draw the path yourself. Rain
particles no longer disappear at the canvas edges. New scale and position
controls. PNG sequence is now the only export.

**This release adds an update check, so the app now makes a network request it
never made before.** [What it sends](#about-the-update-check) is below, along
with how to turn it off.

## Download

**[PNG-Animator-Setup-1.0.4.exe](../../releases/download/v1.0.4/PNG-Animator-Setup-1.0.4.exe)** — Windows 10/11, 64-bit, 99 MB

Per-user install, so there's no administrator prompt. Installing over an
earlier version keeps your saved looks — they live in your user profile, not
the program folder.

> **SmartScreen will warn you the first time.** The installer isn't code-signed
> — that needs a paid certificate. Choose **More info**, then **Run anyway**.

## Seven new presets

| | |
| --- | --- |
| **Orbit** | Copies riding an ellipse, growing and brightening as they come round the front so it reads as a ring rather than a flat circle. |
| **Fly-through** | Copies rushing past the camera out of a vanishing point, fading in and out at the far and near ends. |
| **Tumble** | A whole number of turns per loop, with optional drift in both axes. |
| **Ripple grid** | A grid of copies with the pulse travelling outward from the centre. |
| **Radial array** | Copies on a ring, the ring turning a whole number of its own segments. |
| **Flag wave** | The artwork sliced into strips and rippled by a travelling wave — the only preset that bends the image rather than moving it. |
| **Path** | Drag out a curve and the artwork follows it. |

**Path** is worth a moment. You drag four points — two ends and two handles —
exactly like the easing curve, except this curve is *where* the artwork goes.
Because the easing curve still controls timing, the two work together: the path
sets the route, the easing curve sets the speed along it.

An open curve can't loop on its own, since the artwork would have to jump from
the end back to the start. So there are two modes. **Ping-pong** runs out along
the curve and back again. **Closed** ties the end point to the start so the
curve joins up and the artwork comes round. Switching between them never
destroys the points you dragged.

Every preset still closes its loop exactly, as before.

## Fixed

**Rain particles vanished near the edges of the canvas.** A particle drifting
toward an edge would go completely off-canvas and stay gone for part of the
loop — at default settings the worst-placed one was invisible for **half of
it**. Particles now slide off the edge and back the way they should, and none
is ever entirely missing. Nothing about your existing seeds changes; the same
seed gives the same arrangement.

## New controls

**Master scale** sits with master speed and amplitude and resizes the artwork
across every preset — particle size for Rain, tile size for the scrolls, fit
for the single-image presets.

**Offset X and Offset Y** sit under the seed, in fractions of the canvas, with
a **recentre** button once you've moved something. They nudge an arrangement
instead of rerolling it into a different one — useful when a seed is almost
right but sitting slightly wrong. For Rain and the scrolls the offset wraps at
the edges, so it never opens a gap.

Both travel with saved looks and the JSON, so old saves load exactly as before.

## Export

**PNG sequence is now the only export.** WebM and MP4 are gone. The sequence
keeps full alpha, imports into every editor, and converts to any codec you
need, so the video encoders were adding complexity for a job it already does
better. The panel still gives you a ready-to-paste `ffmpeg` command with the
real paths filled in:

```
ffmpeg -framerate 30 -i name_%04d.png \
  -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le name.mov
```

## About the update check

On launch the app asks the public GitHub releases API which release is latest.
If it's newer than the one you're running, a bar appears offering the release
notes, with **skip this one** and a dismiss button. If it isn't, you see
nothing.

- **Nothing is sent but the request.** No identifier, no version number, no
  telemetry, nothing about your images or your machine.
- **The only thing GitHub learns** is that an IP address asked which release is
  latest.
- **It fails silently.** Offline, behind a proxy or rate-limited all look like
  a normal start.
- **Your images never leave your machine**, under any setting. That has not
  changed and will not.

**To turn it off:** uncheck **Help → Check for Updates on Launch**. With it off
the app makes no network requests at all — which is how every release before
this one behaved. There is also **Help → Check for Updates Now** if you'd
rather ask only when you feel like it.

Earlier releases said the app never connects to anything. That's no longer
true, which is why it's spelled out here rather than left in the small print.

## Also

**Toggle Developer Tools** has been removed from the View menu.

## Privacy

No telemetry and no accounts. Your images are never uploaded anywhere. The only
network request is the update check described above, and it can be switched off.
