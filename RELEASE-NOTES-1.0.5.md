Keyframes on almost every slider. Saved looks now remember the PNG they were
made with, and can be exported to a file. The Path preset's closed loop is
properly movable, with a new restart mode.

## Download

**[PNG-Animator-Setup-1.0.5.exe](../../releases/download/v1.0.5/PNG-Animator-Setup-1.0.5.exe)** — Windows 10/11, 64-bit, 99 MB

Per-user install, so there's no administrator prompt. Installing over an
earlier version keeps your saved looks — see [Saved looks](#saved-looks) for
what happens to them.

> **SmartScreen will warn you the first time.** The installer isn't code-signed
> — that needs a paid certificate. Choose **More info**, then **Run anyway**.

## Keyframes

Almost every slider can now change over the loop instead of holding one value.

Click the **◆** beside a slider to turn it on. Move the playhead, move the
slider, and that becomes a key. A track under the slider shows your keys —
click one to jump to it, or the **✕** to delete the one you're sitting on.
Click the **◆** again to go back to a fixed value.

Seventy preset parameters can be keyed, plus master amplitude, scale and both
offsets. Rain's particle count, a preset's rotation, the drift on a scroll, the
size of an orbit — all of it can move.

**Keyframes can't break your loop.** Keys sit on a circle rather than a line:
after the last key the value travels back round to the first. However you place
them, the value at the end of the loop is the value at the start, so the
animation still closes.

Keys are read at the position on the timeline where you set them, not through
the easing curve — so moving the easing curve afterwards won't slide your keys
off the frames you put them on.

## Saved looks

**A saved look now includes the PNG it was made with.** Before, it stored only
the settings, so reloading one gave you the parameters back but not the
artwork — you had to remember which image went with which look and load it by
hand.

**Export and import.** Every saved look has a **⇩** button that writes it to a
single `.pnganim` file — settings and image together — and there's an **import**
button beside save. Keep a look next to the artwork it belongs to, move your
library to another machine, or send one to someone else.

Looks now live on disk in your user profile rather than in browser storage,
which is what makes room for the artwork. **Your existing saves are moved
across automatically the first time you run this version.** They'll keep their
names and settings, but they can't gain an image they never stored — re-save
them with the artwork loaded if you want it attached.

### Fixed: detect slicing didn't survive a save

If you used **detect** slicing, confirmed the regions and saved the look,
reloading it gave you the mode back but not the regions — so it quietly
animated the whole image as one piece instead of the separate shapes. The
regions now travel with the look, along with the grid rows and columns and the
minimum region size.

## Path

**The closed loop is properly movable.** The two ends are one point now, so
dragging either moves the join and the whole loop with it, rather than leaving
one end anchored. You can also drag the curve itself to move all four points
together.

**Points can go outside the canvas.** The editor shows the area beyond the
canvas edges, with the canvas drawn as an inner rectangle, so you can place a
handle off-canvas and still see and grab it — useful for sweeping something in
from outside the frame.

**New restart loop mode.** One pass from end to end, then a cut straight back
to the start. It's the one mode that deliberately doesn't join up, which is
what you want when something should enter, exit, and enter again.

## Privacy

No telemetry and no accounts. Your images are never uploaded anywhere. The only
network request is the update check, which asks the public GitHub releases API
which release is latest and sends nothing but the request itself. Turn it off
under **Help → Check for Updates on Launch** and the app makes no network
requests at all.
