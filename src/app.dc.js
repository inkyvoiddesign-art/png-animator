const HEART_SLICES = [
  { x: 450, y: 141, w: 399, h: 335 },
  { x: 49,  y: 349, w: 399, h: 335 },
  { x: 450, y: 539, w: 479, h: 401 }
];
const HB_W = 399, HB_H = 335;

const PRESETS = [
  ['rain', 'Rain'], ['scrollV', 'Scroll · vertical'], ['scrollH', 'Scroll · horizontal'],
  ['bob', 'Idle bob'], ['breathe', 'Breathe'], ['sway', 'Sway'], ['float', 'Float'], ['pop', 'Pop'],
  ['orbit', 'Orbit'], ['fly', 'Fly-through'], ['tumble', 'Tumble'],
  ['ripple', 'Ripple grid'], ['radial', 'Radial array'], ['flag', 'Flag wave'], ['path', 'Path']
];
const CANVAS_PRESETS = {
  '1080×1920 vertical': [1080, 1920], '1080×1350 portrait': [1080, 1350],
  '1080×1080 square': [1080, 1080], '1920×1080 widescreen': [1920, 1080], 'custom': null
};

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, u) => a + (b - a) * u;
const frac = (v) => v - Math.floor(v);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;

// Desktop bridge — present only inside the Electron shell (electron/preload.js).
// Every call site below falls back to the browser path when it is absent, so
// this file still runs unchanged as a plain page.
const NATIVE = typeof window !== 'undefined' ? window.pngAnimatorNative : null;
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

/*
 * Wraps a sprite centre through one full span so it leaves one edge exactly as
 * it re-enters the other. The span is the canvas plus one sprite, and the
 * result is a LEFT/TOP edge, so both wrap points sit fully off-canvas and the
 * seam is never visible. Getting this offset wrong is what used to teleport a
 * particle across the canvas the moment sway carried it past an edge.
 */
const wrapAxis = (centre, extent, size) => {
  const span = extent + size;
  return frac((centre + size / 2) / span) * span - size;
};

/* A cubic Bezier in the plane: P is [x0,y0, c1x,c1y, c2x,c2y, x1,y1] in
   normalised canvas coordinates. The Path preset walks this curve. */
/*
 * Keyframes live on the loop, not on a line: after the last key the value
 * travels back round to the first. That wrap is what keeps a keyframed
 * parameter loop-safe - however you place the keys, the value at t=1 is the
 * value at t=0, so the animation still closes.
 *
 * keys is [[t, value], ...] sorted by t, with t in [0,1).
 */
function sampleKeys(keys, t) {
  const n = keys.length;
  if (!n) return 0;
  if (n === 1) return keys[0][1];
  const u = frac(t);
  let i = -1;
  for (let k = 0; k < n; k++) { if (keys[k][0] <= u) i = k; else break; }
  let a, b, span, local;
  if (i < 0) {                       // before the first key: coming round the seam
    a = keys[n - 1]; b = keys[0];
    span = (1 - a[0]) + b[0];
    local = span <= 0 ? 0 : (u + (1 - a[0])) / span;
  } else if (i === n - 1) {          // after the last: heading into the seam
    a = keys[n - 1]; b = keys[0];
    span = (1 - a[0]) + b[0];
    local = span <= 0 ? 0 : (u - a[0]) / span;
  } else {
    a = keys[i]; b = keys[i + 1];
    span = b[0] - a[0];
    local = span <= 0 ? 0 : (u - a[0]) / span;
  }
  return lerp(a[1], b[1], clamp(local, 0, 1));
}

/* Replace the key at this time if there is one, otherwise insert in order. */
function upsertKey(keys, t, v) {
  const out = (keys || []).filter((k) => Math.abs(k[0] - t) > 0.0005);
  out.push([t, v]);
  out.sort((a, b) => a[0] - b[0]);
  return out;
}
function removeKeyAt(keys, t) {
  const out = (keys || []).filter((k) => Math.abs(k[0] - t) > 0.0005);
  return out.length ? out : null;
}
function keyAt(keys, t) {
  return !!(keys || []).some((k) => Math.abs(k[0] - t) <= 0.0005);
}

function bezPoint(P, u) {
  const m = 1 - u, a = m * m * m, b = 3 * m * m * u, c = 3 * m * u * u, d = u * u * u;
  return [a * P[0] + b * P[2] + c * P[4] + d * P[6], a * P[1] + b * P[3] + c * P[5] + d * P[7]];
}
function bezTangent(P, u) {
  const m = 1 - u, a = 3 * m * m, b = 6 * m * u, c = 3 * u * u;
  return [a * (P[2] - P[0]) + b * (P[4] - P[2]) + c * (P[6] - P[4]),
          a * (P[3] - P[1]) + b * (P[5] - P[3]) + c * (P[7] - P[5])];
}

function bezierY(p1x, p1y, p2x, p2y, x) {
  const bx = (u) => 3 * u * (1 - u) * (1 - u) * p1x + 3 * u * u * (1 - u) * p2x + u * u * u;
  const by = (u) => 3 * u * (1 - u) * (1 - u) * p1y + 3 * u * u * (1 - u) * p2y + u * u * u;
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 22; i++) { u = (lo + hi) / 2; if (bx(u) < x) lo = u; else hi = u; }
  return by((lo + hi) / 2);
}

class Component extends DCLogic {
  state = {
    playing: true, t: 0, seamCheck: false,
    preset: 'rain',
    duration: 3, fps: 30, cw: 1080, ch: 1920, canvasPreset: '1080×1920 vertical',
    speed: 1, amp: 1, scale: 1, seed: 1337, offX: 0, offY: 0,
    ease: 'linear', bez: [0.42, 0.0, 0.58, 1.0],
    bg: 'transparent', bgColor: '#0b0b12', bgImageName: 'load image…',
    sliceMode: 'whole', rows: 2, cols: 2, minArea: 0.4,
    detected: null, detectSummary: 'not run',
    srcName: 'no image loaded', srcDims: 'drop a PNG anywhere', borderPct: null,
    rain: { count: 45, scaleMin: 0.08, scaleMax: 0.22, tiers: 4, sway: 0.06, rot: 12, opMin: 0.45, opMax: 1, depthFade: 1, mirror: true, glow: false, wind: 0, dir: 'down', bias: 0 },
    scrollV: { tiles: 1, tileScale: 0.5, angle: 0, dir: 'down', parallax: true, pRate: 2, pScale: 0.62, pOpacity: 0.4 },
    scrollH: { tiles: 1, tileScale: 0.5, angle: 0, dir: 'left', parallax: false, pRate: 2, pScale: 0.62, pOpacity: 0.4 },
    bob: { fit: 0.7, amp: 0.05, squash: 0.06 },
    breathe: { fit: 0.7, amount: 0.055 },
    sway: { fit: 0.7, deg: 6 },
    float: { fit: 0.7, amp: 0.04, driftX: 0.03, driftY: 0.02, cyclesX: 1, cyclesY: 2 },
    pop: { fit: 0.7, overshoot: 0.18, rise: 0.3, hold: 0.45 },
    orbit: { count: 10, radiusX: 0.3, radiusY: 0.12, size: 0.16, tiers: 1, depth: 0.35, opMin: 0.55, rot: 0, dir: 'cw' },
    fly: { count: 26, spread: 0.5, startScale: 0.04, endScale: 0.85, tiers: 1, fade: 0.18, rot: 0, curve: 2 },
    tumble: { fit: 0.6, turns: 1, driftX: 0.12, driftY: 0.06, cyclesX: 1, cyclesY: 1, dir: 'cw' },
    ripple: { cols: 4, rows: 6, size: 0.8, cycles: 1, amount: 0.35, falloff: 1.2, fade: 0.3 },
    radial: { count: 6, radius: 0.3, size: 0.2, spin: 1, faceOut: true, dir: 'cw' },
    flag: { fit: 0.8, strips: 28, amp: 0.05, waves: 1, cycles: 1, axis: 'x', taper: 0 },
    path: { fit: 0.5, pts: [0.12, 0.5, 0.3, 0.12, 0.7, 0.88, 0.88, 0.5], loop: 'ping-pong', orient: false, spin: 0 },
    busy: false, progress: 0, progressLabel: '', ffmpegCmd: '',
    saves: [], saveName: '', update: null, masterKeys: {},
    jsonText: '', jsonHint: 'Current preset + global settings. Edit and hit apply to restore a look.'
  };

  rt = { amp: 1, scale: 1, offX: 0, offY: 0 };

  mainRef = React.createRef();
  srcImgRef = React.createRef();
  thumbRef = React.createRef();
  detectRef = React.createRef();

  componentDidMount() {
    this.raf = requestAnimationFrame(this.loop);
    if (NATIVE && NATIVE.looks) {
      this.migrateLocalSaves().then(() => this.refreshLooks());
    } else {
      try {
        const raw = localStorage.getItem('pngAnimator.saves');
        if (raw) this.setState({ saves: JSON.parse(raw) });
      } catch (e) {}
    }
    if (NATIVE) this.offOpen = NATIVE.onOpenImage(({ name, bytes }) => this.loadImageBytes(name, bytes));
    // Main only sends this when a newer release actually exists.
    if (NATIVE && NATIVE.onUpdateAvailable) this.offUpdate = NATIVE.onUpdateAvailable((u) => this.setState({ update: u }));
  }
  componentWillUnmount() {
    cancelAnimationFrame(this.raf);
    if (this.offOpen) this.offOpen();
    if (this.offUpdate) this.offUpdate();
  }

  adopt(img, name) {
    this.img = img;
    const n = 64, c = document.createElement('canvas');
    c.width = n; c.height = n;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, n, n);
    const d = g.getImageData(0, 0, n, n).data;
    let op = 0, tot = 0;
    for (let i = 0; i < n; i++) {
      const e = [i * 4 + 3, ((n - 1) * n + i) * 4 + 3, (i * n) * 4 + 3, (i * n + n - 1) * 4 + 3];
      for (const k of e) { tot++; if (d[k] > 24) op++; }
    }
    this.setState({
      srcName: name, srcDims: img.width + '×' + img.height,
      borderPct: (op / tot) * 100,
      sliceMode: 'whole', detected: null, detectSummary: 'not run'
    }, () => {
      this.slice(); this.build(); this.drawThumb(); this.syncJson();
      if (this.pendingLook) { const fn = this.pendingLook; this.pendingLook = null; fn(); }
    });
  }

  /* The bytes are kept as well as the decoded image, because a saved look is
     no use without the PNG it was built for. */
  loadImageBytes(name, bytes) {
    this.srcBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const img = new Image();
    img.onload = () => { this.adopt(img, name); URL.revokeObjectURL(url); };
    img.src = url;
  }

  onFileLoad = (file) => {
    if (!file) return;
    file.arrayBuffer().then((b) => { this.srcBytes = new Uint8Array(b); }).catch(() => { this.srcBytes = null; });
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { this.adopt(img, file.name); URL.revokeObjectURL(url); };
    img.src = url;
  };

  drawThumb() {
    const c = this.thumbRef.current;
    if (!c || !this.img) return;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / this.img.width, c.height / this.img.height);
    const w = this.img.width * k, h = this.img.height * k;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.img, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }

  slice() {
    if (!this.img) return;
    const S = this.state;
    let boxes;
    if (S.sliceMode === 'hearts') boxes = HEART_SLICES.slice();
    else if (S.sliceMode === 'grid') {
      boxes = [];
      const tw = this.img.width / S.cols, th = this.img.height / S.rows;
      for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) boxes.push({ x: c * tw, y: r * th, w: tw, h: th });
    } else if (S.sliceMode === 'detect' && S.detected) boxes = S.detected.slice();
    else boxes = [{ x: 0, y: 0, w: this.img.width, h: this.img.height }];

    const bw = boxes[0].w, bh = boxes[0].h;
    this.baseW = Math.round(bw); this.baseH = Math.round(bh);
    this.sprites = boxes.map((b) => {
      const c = document.createElement('canvas');
      c.width = Math.round(bw); c.height = Math.round(bh);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      const k = Math.min(bw / b.w, bh / b.h);
      const w = b.w * k, h = b.h * k;
      g.drawImage(this.img, b.x, b.y, b.w, b.h, (bw - w) / 2, (bh - h) / 2, w, h);
      return c;
    });
  }

  detect() {
    if (!this.img) return;
    const W = 220, H = Math.max(1, Math.round(this.img.height * (W / this.img.width)));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(this.img, 0, 0, W, H);
    const a = g.getImageData(0, 0, W, H).data;
    const seen = new Uint8Array(W * H), boxes = [];
    const minPx = (this.state.minArea / 100) * W * H;
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || a[i * 4 + 3] < 32) continue;
      let x0 = i % W, x1 = x0, y0 = (i / W) | 0, y1 = y0, n = 0;
      const st = [i]; seen[i] = 1;
      while (st.length) {
        const p = st.pop(); n++;
        const px = p % W, py = (p / W) | 0;
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
        const nb = [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1];
        for (const q of nb) if (q >= 0 && !seen[q] && a[q * 4 + 3] >= 32) { seen[q] = 1; st.push(q); }
      }
      if (n >= minPx) boxes.push({ x0, y0, x1, y1, n });
    }
    boxes.sort((p, q) => q.n - p.n);
    const k = this.img.width / W;
    const out = boxes.slice(0, 24).map((b) => ({
      x: Math.round(b.x0 * k), y: Math.round(b.y0 * k),
      w: Math.round((b.x1 - b.x0 + 1) * k), h: Math.round((b.y1 - b.y0 + 1) * k)
    }));
    this.pending = out;
    this.setState({ detectSummary: out.length + ' region(s) found — confirm to use' }, () => this.drawDetect(out));
  }

  drawDetect(boxes) {
    const c = this.detectRef.current;
    if (!c || !this.img) return;
    c.height = Math.max(1, Math.round(c.width * (this.img.height / this.img.width)));
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.img, 0, 0, c.width, c.height);
    const k = c.width / this.img.width;
    g.strokeStyle = '#5cc8e8'; g.lineWidth = 1.25;
    g.font = '9px monospace'; g.fillStyle = '#5cc8e8';
    (boxes || []).forEach((b, i) => {
      g.strokeRect(b.x * k, b.y * k, b.w * k, b.h * k);
      g.fillText(String.fromCharCode(65 + i), b.x * k + 2, b.y * k + 10);
    });
  }

  build() {
    const r = mulberry32(this.state.seed >>> 0);
    this.parts = [];
    for (let i = 0; i < 300; i++) {
      this.parts.push({
        s: r(), mirror: r() < 0.5, rScale: r(), rRot: r() * 2 - 1,
        rTier: r(), rSway: r(), cycles: 1 + Math.floor(r() * 3),
        swayPhase: r(), x0: r(), phase: r()
      });
    }
    this.parts.sort((a, b) => a.rScale - b.rScale);
  }

  ease(t) {
    const S = this.state;
    if (S.ease === 'linear') return t;
    if (S.ease === 'ease-in-out') return bezierY(0.42, 0, 0.58, 1, t);
    if (S.ease === 'elastic') return t <= 0 || t >= 1 ? t : 1 - Math.pow(2, -10 * t) * Math.cos(t * 12);
    return bezierY(S.bez[0], S.bez[1], S.bez[2], S.bez[3], t);
  }

  loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.exporting) return;
    const S = this.state;
    if (S.playing) {
      const t = frac((performance.now() / 1000) * S.speed / S.duration);
      this.setState({ t });
      this.paint(this.mainRef.current, t);
    } else this.paint(this.mainRef.current, S.t);
  };

  paint(cv, t) {
    if (!cv || !this.sprites) return;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const frames = this.frames();
    if (this.state.seamCheck) {
      this.render(g, 0, cv.width, cv.height, true);
      g.globalCompositeOperation = 'difference';
      this.render(g, 1 - 1 / frames, cv.width, cv.height, false);
      g.globalCompositeOperation = 'source-over';
    } else this.render(g, t, cv.width, cv.height, true);
  }

  frames() { return Math.max(1, Math.round(this.state.fps * this.state.duration)); }

  drawBg(g, W, H, forExport) {
    const S = this.state;
    if (S.bg === 'color' || (forExport === 'flatten')) {
      g.fillStyle = S.bg === 'color' ? S.bgColor : '#000000';
      g.fillRect(0, 0, W, H);
    }
    if (S.bg === 'image' && this.bgImg) {
      const k = Math.max(W / this.bgImg.width, H / this.bgImg.height);
      const w = this.bgImg.width * k, h = this.bgImg.height * k;
      g.drawImage(this.bgImg, (W - w) / 2, (H - h) / 2, w, h);
    }
  }

  render(g, rawT, W, H, clear) {
    const S = this.state;
    if (clear) g.clearRect(0, 0, W, H);
    this.drawBg(g, W, H, this.flatten);
    /* Keyframes are read at the raw timeline position, because that is where
       the scrubber put them. Motion is read at the eased position. Sampling
       keys through the easing curve would slide every key off the frame it
       was set on. */
    const kt = frac(rawT);
    const t = this.ease(kt);
    this.rt = this.resolveMaster(kt);
    const p = this.resolveParams(S[S.preset], kt);
    if (S.preset === 'rain') return this.rRain(g, t, W, H, p);
    if (S.preset === 'scrollV' || S.preset === 'scrollH') return this.rScroll(g, t, W, H, p, S.preset === 'scrollV');
    if (S.preset === 'orbit') return this.rOrbit(g, t, W, H, p);
    if (S.preset === 'fly') return this.rFly(g, t, W, H, p);
    if (S.preset === 'ripple') return this.rRipple(g, t, W, H, p);
    if (S.preset === 'radial') return this.rRadial(g, t, W, H, p);
    if (S.preset === 'flag') return this.rFlag(g, t, W, H, p);
    if (S.preset === 'path') return this.rPath(g, t, W, H, p);
    return this.rSingle(g, t, W, H, p, S.preset);
  }

  /* A shallow copy of the preset params with every keyframed one replaced by
     its value at this point in the loop. Renderers stay unchanged - they still
     just read p.whatever. */
  resolveParams(p, t) {
    const keys = p && p._keys;
    if (!keys) return p;
    const out = Object.assign({}, p);
    for (const k in keys) {
      const arr = keys[k];
      if (arr && arr.length) out[k] = sampleKeys(arr, t);
    }
    return out;
  }

  resolveMaster(t) {
    const S = this.state, mk = S.masterKeys || {};
    const pick = (name) => (mk[name] && mk[name].length ? sampleKeys(mk[name], t) : S[name]);
    return { amp: pick('amp'), scale: pick('scale'), offX: pick('offX'), offY: pick('offY') };
  }

  rRain(g, t, W, H, p) {
    const S = this.state, A = this.rt.amp;
    const horiz = p.dir === 'left' || p.dir === 'right';
    const count = Math.min(Math.round(p.count), this.parts.length);
    for (let i = 0; i < count; i++) {
      const q = this.parts[i];
      const sc = lerp(p.scaleMin, p.scaleMax, q.rScale);
      const w = W * sc * this.rt.scale, h = w * (this.baseH / this.baseW);
      const fade = lerp(1, q.rScale, clamp(p.depthFade, 0, 1));
      const op = clamp(lerp(p.opMin, p.opMax, fade), 0, 1);
      const rot = q.rRot * (p.rot * Math.PI / 180);
      const tier = 1 + (Math.floor(q.rTier * Math.max(1, Math.round(p.tiers))) % Math.max(1, Math.round(p.tiers)));
      const along = frac(Math.pow(q.phase, 1 + clamp(p.bias, 0, 1) * 2) + t * tier);
      const swayAmp = q.rSway * p.sway * W * A;
      const sway = swayAmp * Math.sin(TAU * (t * q.cycles + q.swayPhase));
      const wind = Math.round(p.wind) * t * (horiz ? H : W);
      const offX = this.rt.offX * W, offY = this.rt.offY * H;
      let x, y;
      if (horiz) {
        const prog = p.dir === 'left' ? 1 - along : along;
        x = wrapAxis(prog * (W + w) - w / 2 + offX, W, w);
        y = wrapAxis(q.x0 * H + sway + wind + offY, H, h);
      } else {
        const prog = p.dir === 'up' ? 1 - along : along;
        y = wrapAxis(prog * (H + h) - h / 2 + offY, H, h);
        x = wrapAxis(q.x0 * W + sway + wind + offX, W, w);
      }
      const spr = this.sprites[Math.floor(q.s * this.sprites.length) % this.sprites.length];
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.rotate(rot);
      if (p.mirror && q.mirror) g.scale(-1, 1);
      if (p.glow) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = op * 0.22;
        g.drawImage(spr, -w * 0.53, -h * 0.53, w * 1.06, h * 1.06);
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = op;
      g.drawImage(spr, -w / 2, -h / 2, w, h);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  rScroll(g, t, W, H, p, vertical) {
    const src = this.sprites[0];
    const layers = p.parallax
      ? [{ k: p.tileScale * p.pScale, rate: Math.round(p.tiles * Math.round(p.pRate)), a: p.pOpacity }, { k: p.tileScale, rate: Math.round(p.tiles), a: 1 }]
      : [{ k: p.tileScale, rate: Math.round(p.tiles), a: 1 }];
    const ang = (p.angle || 0) * Math.PI / 180;
    for (const L of layers) {
      const tw = W * L.k * this.rt.scale, th = tw * (src.height / src.width);
      const cols = Math.ceil(W / tw) + 2, rows = Math.ceil(H / th) + 2;
      const sign = (vertical ? p.dir === 'up' : p.dir === 'left') ? -1 : 1;
      const prog = frac(t * L.rate) * sign;
      const main = vertical ? prog * th : prog * tw;
      const cross = vertical ? Math.tan(ang) * main : Math.tan(ang) * main;
      const offX = this.rt.offX * W, offY = this.rt.offY * H;
      const ox = frac(((vertical ? cross : main) + offX) / tw) * tw;
      const oy = frac(((vertical ? main : cross) + offY) / th) * th;
      g.globalAlpha = L.a;
      for (let cx = -1; cx < cols; cx++)
        for (let cy = -1; cy < rows; cy++)
          g.drawImage(src, cx * tw + ox, cy * th + oy, tw, th);
      g.globalAlpha = 1;
    }
  }

  rSingle(g, t, W, H, p, preset) {
    const src = this.sprites[0], A = this.rt.amp;
    const k = Math.min(W * 0.85 / src.width, H * 0.85 / src.height) * (p.fit / 0.7) * this.rt.scale;
    const w = src.width * k, h = src.height * k;
    const cx = W / 2, baseY = H / 2 + h / 2;
    let dx = 0, dy = 0, sx = 1, sy = 1, rot = 0;
    const u = Math.sin(TAU * t);
    if (preset === 'bob') {
      dy = -p.amp * H * A * u;
      const down = Math.max(0, -u);
      sy = 1 - p.squash * A * down; sx = 1 + p.squash * A * down * 0.6;
    } else if (preset === 'breathe') {
      sy = 1 + p.amount * A * u; sx = 1 - p.amount * A * u * 0.5;
    } else if (preset === 'sway') {
      rot = p.deg * A * u * Math.PI / 180;
    } else if (preset === 'float') {
      dy = -p.amp * H * A * u + p.driftY * H * A * Math.sin(TAU * (t * Math.round(p.cyclesY) + 0.25));
      dx = p.driftX * W * A * Math.sin(TAU * t * Math.round(p.cyclesX));
    } else if (preset === 'tumble') {
      // A whole number of turns lands back where it started, so the loop closes.
      rot = TAU * Math.round(p.turns) * t * (p.dir === 'ccw' ? -1 : 1);
      dx = p.driftX * W * A * Math.sin(TAU * t * Math.round(p.cyclesX));
      dy = -p.driftY * H * A * Math.sin(TAU * t * Math.round(p.cyclesY));
    } else if (preset === 'pop') {
      const rise = clamp(p.rise, 0.05, 0.9), hold = clamp(p.hold, 0, 1 - rise);
      let s;
      if (t < rise) {
        const q = t / rise, c = 1 + p.overshoot * 6;
        s = 1 + (c + 1) * Math.pow(q - 1, 3) + c * Math.pow(q - 1, 2);
      } else if (t < rise + hold) s = 1;
      else {
        const q = (t - rise - hold) / Math.max(0.0001, 1 - rise - hold);
        s = 1 - q * q;
      }
      sx = s; sy = s;
    }
    g.save();
    g.translate(cx + dx + this.rt.offX * W, baseY + dy + this.rt.offY * H);
    g.rotate(rot);
    g.scale(sx, sy);
    g.drawImage(src, -w / 2, -h, w, h);
    g.restore();
  }

  /* Every preset below closes its loop by construction: anything driven by t
     completes a whole number of cycles, and anything that wraps fades to zero
     at the seam so the jump is invisible. */

  spriteFor(q) {
    const n = this.sprites.length;
    return this.sprites[Math.floor(q.s * n) % n];
  }

  // Sprites riding an ellipse. The size and opacity swing between the near and
  // far halves is what sells it as a ring rather than a flat circle.
  rOrbit(g, t, W, H, p) {
    const S = this.state, A = this.rt.amp;
    const count = Math.min(Math.round(p.count), this.parts.length);
    const cx = W / 2 + this.rt.offX * W, cy = H / 2 + this.rt.offY * H;
    const sign = p.dir === 'ccw' ? -1 : 1;
    const items = [];
    for (let i = 0; i < count; i++) {
      const q = this.parts[i];
      const tier = 1 + Math.floor(q.rTier * Math.max(1, Math.round(p.tiers)));
      const ang = TAU * (q.phase + t * tier) * sign;
      const dep = Math.sin(ang);
      items.push({
        x: cx + p.radiusX * W * Math.cos(ang),
        y: cy + p.radiusY * H * dep,
        k: 1 + clamp(p.depth, 0, 1) * dep * A,
        dep,
        op: clamp(lerp(p.opMin, 1, (dep + 1) / 2), 0, 1),
        rot: q.rRot * (p.rot * Math.PI / 180),
        spr: this.spriteFor(q)
      });
    }
    items.sort((a, b) => a.dep - b.dep);
    for (const it of items) {
      const w = W * p.size * this.rt.scale * Math.max(0.01, it.k);
      const h = w * (this.baseH / this.baseW);
      g.save();
      g.translate(it.x, it.y);
      g.rotate(it.rot);
      g.globalAlpha = it.op;
      g.drawImage(it.spr, -w / 2, -h / 2, w, h);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // Sprites rushing past the camera. Depth wraps, so each one fades to nothing
  // at both ends of its travel or the wrap would show as a pop.
  rFly(g, t, W, H, p) {
    const S = this.state;
    const count = Math.min(Math.round(p.count), this.parts.length);
    const cx = W / 2 + this.rt.offX * W, cy = H / 2 + this.rt.offY * H;
    const fade = clamp(p.fade, 0.01, 0.49);
    const items = [];
    for (let i = 0; i < count; i++) {
      const q = this.parts[i];
      const tier = 1 + Math.floor(q.rTier * Math.max(1, Math.round(p.tiers)));
      const z = frac(q.phase + t * tier);
      const e = Math.pow(z, Math.max(0.2, p.curve));
      const ang = q.x0 * TAU;
      const dist = p.spread * Math.min(W, H) * e;
      items.push({
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        k: lerp(p.startScale, p.endScale, e),
        z,
        op: clamp(Math.min(z, 1 - z) / fade, 0, 1),
        rot: q.rRot * (p.rot * Math.PI / 180),
        spr: this.spriteFor(q)
      });
    }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) {
      const w = W * it.k * this.rt.scale, h = w * (this.baseH / this.baseW);
      g.save();
      g.translate(it.x, it.y);
      g.rotate(it.rot);
      g.globalAlpha = it.op;
      g.drawImage(it.spr, -w / 2, -h / 2, w, h);
      g.restore();
    }
    g.globalAlpha = 1;
  }

  // A grid where the pulse travels outward from the centre. Whole cycles only,
  // so the wave is back where it started at the end of the loop.
  rRipple(g, t, W, H, p) {
    const S = this.state, A = this.rt.amp, src = this.sprites[0];
    const cols = Math.max(1, Math.round(p.cols)), rows = Math.max(1, Math.round(p.rows));
    const cw = W / cols, ch = H / rows;
    const base = Math.min(cw, ch) * p.size * this.rt.scale;
    const bw = base, bh = base * (src.height / src.width);
    const cycles = Math.max(1, Math.round(p.cycles));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = cw * (c + 0.5) + this.rt.offX * W, y = ch * (r + 0.5) + this.rt.offY * H;
        const dx = (c + 0.5) / cols - 0.5, dy = (r + 0.5) / rows - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const u = Math.sin(TAU * (t * cycles - d * p.falloff));
        const k = Math.max(0.01, 1 + p.amount * A * u);
        g.save();
        g.translate(x, y);
        g.globalAlpha = clamp(1 - p.fade * (1 - (u + 1) / 2), 0, 1);
        g.drawImage(src, -bw * k / 2, -bh * k / 2, bw * k, bh * k);
        g.restore();
      }
    }
    g.globalAlpha = 1;
  }

  // N copies on a ring. Turning the ring by a whole number of its own segments
  // lands it back on an identical arrangement, so any integer spin closes.
  rRadial(g, t, W, H, p) {
    const S = this.state, src = this.sprites[0];
    const n = Math.max(1, Math.round(p.count));
    const cx = W / 2 + this.rt.offX * W, cy = H / 2 + this.rt.offY * H;
    const sign = p.dir === 'ccw' ? -1 : 1;
    const spin = TAU * (Math.round(p.spin) / n) * t * sign;
    const w = W * p.size * this.rt.scale, h = w * (src.height / src.width);
    for (let i = 0; i < n; i++) {
      const ang = TAU * (i / n) + spin;
      g.save();
      g.translate(cx + Math.cos(ang) * p.radius * W, cy + Math.sin(ang) * p.radius * W);
      if (p.faceOut) g.rotate(ang + Math.PI / 2);
      g.drawImage(src, -w / 2, -h / 2, w, h);
      g.restore();
    }
  }

  // The sprite cut into strips, each displaced by a travelling sine. The only
  // preset that deforms the artwork rather than moving it.
  rFlag(g, t, W, H, p) {
    const S = this.state, A = this.rt.amp, src = this.sprites[0];
    const k = Math.min(W * 0.85 / src.width, H * 0.85 / src.height) * (p.fit / 0.7) * this.rt.scale;
    const w = src.width * k, h = src.height * k;
    const x0 = W / 2 - w / 2 + this.rt.offX * W, y0 = H / 2 - h / 2 + this.rt.offY * H;
    const n = Math.max(2, Math.round(p.strips));
    const across = p.axis === 'x';
    const cycles = Math.max(1, Math.round(p.cycles));
    const waves = Math.max(0, p.waves);
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n;
      const u = Math.sin(TAU * (t * cycles - f0 * waves));
      const taper = lerp(1, f0, clamp(p.taper, 0, 1));
      const d = p.amp * (across ? H : W) * A * u * taper;
      if (across) {
        // The +0.6px overlap hides the seam between neighbouring strips.
        g.drawImage(src, src.width * f0, 0, src.width * (f1 - f0), src.height,
          x0 + w * f0, y0 + d, w * (f1 - f0) + 0.6, h);
      } else {
        g.drawImage(src, 0, src.height * f0, src.width, src.height * (f1 - f0),
          x0 + d, y0 + h * f0, w, h * (f1 - f0) + 0.6);
      }
    }
  }

  // The sprite follows a cubic Bezier you drag out. An open curve cannot loop
  // on its own, so ping-pong retraces it and closed ties the end to the start.
  rPath(g, t, W, H, p) {
    const S = this.state, src = this.sprites[0];
    const k = Math.min(W * 0.85 / src.width, H * 0.85 / src.height) * (p.fit / 0.7) * this.rt.scale;
    const w = src.width * k, h = src.height * k;
    const P = this.pathPoints(p);
    const u = this.pathU(p, t);
    const pt = bezPoint(P, u);
    g.save();
    g.translate(pt[0] * W + this.rt.offX * W, pt[1] * H + this.rt.offY * H);
    if (p.orient) {
      const tan = bezTangent(P, u);
      let a = Math.atan2(tan[1] * H, tan[0] * W);
      // Only ping-pong ever travels backwards along the curve.
      if (p.loop === 'ping-pong' && t >= 0.5) a += Math.PI;
      g.rotate(a);
    }
    if (p.spin) g.rotate(TAU * Math.round(p.spin) * t);
    g.drawImage(src, -w / 2, -h / 2, w, h);
    g.restore();
  }

  /* In closed mode the two ends are one point, so the curve joins up. Dragging
     either end moves both (see pathDrag), which is what makes the whole loop
     movable rather than anchored. The stored points are untouched, so
     switching back to an open mode restores the end where it was. */
  /* How far along the curve at time t.
       ping-pong  out and back, so it returns to the start on its own
       closed     one pass round a curve whose ends meet
       restart    one pass end to end, then a hard cut back to the start */
  pathU(p, t) {
    if (p.loop === 'closed' || p.loop === 'restart') return t;
    return t < 0.5 ? t * 2 : 2 - t * 2;
  }

  pathPoints(p) {
    const P = p.pts.slice();
    if (p.loop === 'closed') { P[6] = P[0]; P[7] = P[1]; }
    return P;
  }

  async stepFrames(cb) {
    const S = this.state, n = this.frames();
    const W = S.cw, H = S.ch;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { alpha: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    this.exporting = true;
    for (let i = 0; i < n; i++) {
      this.render(g, i / n, W, H, true);
      await cb(cv, i, n);
    }
    this.exporting = false;
    return cv;
  }

  name() {
    const S = this.state;
    return (S.srcName.replace(/\.[^.]+$/, '') + '_' + S.preset + '_' + S.fps + 'fps').replace(/[^\w.-]+/g, '-');
  }
  save(blob, ext) {
    if (NATIVE) { this.saveNative(blob, ext); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = this.name() + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  async saveNative(blob, ext) {
    try {
      const res = await NATIVE.saveFile({
        defaultName: this.name() + ext,
        ext: ext.replace(/^\./, ''),
        data: await bytesOf(blob)
      });
      if (res && res.path) this.setState({ ffmpegCmd: 'saved → ' + res.path });
    } catch (err) {
      this.setState({ ffmpegCmd: 'save failed: ' + err.message });
    }
  }

  // Native sequence export writes each frame straight to a folder as it is
  // rendered — no zip, and no holding every frame in memory first.
  async exportPngNative() {
    const name = this.name();
    const picked = await NATIVE.chooseExportFolder({ defaultName: name });
    if (!picked || picked.canceled) return;
    const dir = picked.dir, sep = picked.sep;
    this.setState({ busy: true, progress: 0, progressLabel: 'rendering frames…', ffmpegCmd: '' });
    try {
      await this.stepFrames((cv, i, n) => new Promise((res, rej) => {
        cv.toBlob(async (b) => {
          try {
            await NATIVE.writeFrame(dir, name + '_' + String(i + 1).padStart(4, '0') + '.png', await bytesOf(b));
            this.setState({ progress: (i + 1) / n, progressLabel: 'frame ' + (i + 1) + ' / ' + n });
            res();
          } catch (err) { rej(err); }
        }, 'image/png');
      }));
    } catch (err) {
      this.exporting = false;
      this.setState({ busy: false, progress: 0, progressLabel: '', ffmpegCmd: 'export failed: ' + err.message });
      return;
    }
    const stem = dir + sep + name;
    this.setState({
      busy: false, progress: 0, progressLabel: '',
      ffmpegCmd: this.frames() + ' frames → ' + dir + '\n\n' +
        'ffmpeg -framerate ' + this.state.fps + ' -i "' + stem + '_%04d.png"' +
        ' -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le "' + stem + '.mov"'
    });
    NATIVE.revealPath(dir);
  }

  exportPng = async () => {
    if (this.state.busy) return;
    if (NATIVE) return this.exportPngNative();
    if (!window.JSZip) return;
    const zip = new window.JSZip(), name = this.name();
    this.setState({ busy: true, progress: 0, progressLabel: 'rendering frames…', ffmpegCmd: '' });
    await this.stepFrames((cv, i, n) => new Promise((res) => {
      cv.toBlob((b) => {
        zip.file(name + '_' + String(i + 1).padStart(4, '0') + '.png', b);
        this.setState({ progress: (i + 1) / n, progressLabel: 'frame ' + (i + 1) + ' / ' + n });
        res();
      }, 'image/png');
    }));
    this.setState({ progressLabel: 'zipping…' });
    const blob = await zip.generateAsync({ type: 'blob' }, (m) => this.setState({ progress: m.percent / 100 }));
    this.save(blob, '.zip');
    this.setState({
      busy: false, progressLabel: '',
      ffmpegCmd: 'ffmpeg -framerate ' + this.state.fps + ' -i ' + name + '_%04d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le ' + name + '.mov'
    });
  };

  /* In the desktop app looks live on disk, where there is room for the source
     PNG. In a plain browser they stay in localStorage, settings only, because
     a few megabytes will not hold the artwork. */
  persist(saves) {
    this.setState({ saves });
    if (NATIVE && NATIVE.looks) return;
    try { localStorage.setItem('pngAnimator.saves', JSON.stringify(saves)); } catch (e) {}
  }

  async refreshLooks() {
    if (!(NATIVE && NATIVE.looks)) return;
    try {
      const list = await NATIVE.looks.list();
      this.setState({ saves: list.map((r) => ({ id: r.id, name: r.name, snap: r.snap, hasImage: r.hasImage })) });
    } catch (err) { /* leave the list as it is */ }
  }

  /* One-off move of anything already in localStorage. Those have no artwork,
     which is exactly the limitation this replaces, but losing them would be
     worse than carrying them over settings-only. */
  async migrateLocalSaves() {
    if (!(NATIVE && NATIVE.looks)) return;
    let old = null;
    try { old = JSON.parse(localStorage.getItem('pngAnimator.saves') || 'null'); } catch (e) {}
    if (!Array.isArray(old) || !old.length) return;
    const existing = await NATIVE.looks.list();
    if (existing.length) { try { localStorage.removeItem('pngAnimator.saves'); } catch (e) {} return; }
    for (const rec of old.slice().reverse()) {
      try { await NATIVE.looks.save({ name: rec.name, snap: rec.snap, imageName: null, imageBytes: null }); } catch (e) {}
    }
    try { localStorage.removeItem('pngAnimator.saves'); } catch (e) {}
  }

  snapshot() {
    const S = this.state;
    return {
      preset: S.preset, duration: S.duration, fps: S.fps, cw: S.cw, ch: S.ch,
      canvasPreset: S.canvasPreset, speed: S.speed, amp: S.amp, seed: S.seed,
      ease: S.ease, bez: S.bez.slice(), sliceMode: S.sliceMode,
      /* Without the regions, a detect look reloads as sliceMode 'detect' with
         nothing to slice, and silently animates the whole image instead. */
      detected: S.detected ? JSON.parse(JSON.stringify(S.detected)) : null,
      rows: S.rows, cols: S.cols, minArea: S.minArea,
      scale: S.scale, offX: S.offX, offY: S.offY,
      masterKeys: JSON.parse(JSON.stringify(S.masterKeys || {})),
      params: Object.assign({}, S[S.preset])
    };
  }

  syncJson() {
    const S = this.state;
    this.setState({
      jsonText: JSON.stringify({
        preset: S.preset, duration: S.duration, fps: S.fps, canvas: [S.cw, S.ch],
        speed: S.speed, amp: S.amp, scale: S.scale, seed: S.seed, offX: S.offX, offY: S.offY,
        masterKeys: S.masterKeys && Object.keys(S.masterKeys).length ? S.masterKeys : undefined,
        ease: S.ease, bez: S.bez,
        sliceMode: S.sliceMode, params: S[S.preset]
      }, null, 2)
    });
  }

  set = (k) => (e) => this.setState({ [k]: Number(e.target.value) }, () => this.syncJson());
  setP = (k) => (e) => {
    const p = this.state.preset, v = Number(e.target.value);
    this.setState({ [p]: Object.assign({}, this.state[p], { [k]: v }) }, () => this.syncJson());
  };
  toggleP = (k) => () => {
    const p = this.state.preset;
    this.setState({ [p]: Object.assign({}, this.state[p], { [k]: !this.state[p][k] }) }, () => this.syncJson());
  };
  setPS = (k) => (e) => {
    const p = this.state.preset, v = e.target.value;
    this.setState({ [p]: Object.assign({}, this.state[p], { [k]: v }) }, () => this.syncJson());
  };

  row(label, control) {
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      React.createElement('span', { style: { fontSize: 12.5, color: '#c9c7c4' } }, label), control);
  }

  /*
   * A slider that can be switched from a constant to a set of keyframes.
   * ctx supplies where the value and the keys live, so the same control drives
   * both preset parameters and the master ones.
   */
  kslider(label, min, max, step, ctx) {
    const S = this.state;
    const t = Math.round(frac(S.t) * 1000) / 1000;
    const keys = ctx.keys;
    const on = !!(keys && keys.length);
    const raw = on ? sampleKeys(keys, frac(S.t)) : ctx.constVal;
    const val = Math.round(raw / step) * step;
    const shown = Math.round(val * 10000) / 10000;
    const here = on && keyAt(keys, t);

    const change = (e) => {
      const v = Number(e.target.value);
      if (!on) return ctx.onConst(v);
      ctx.onKeys(upsertKey(keys, t, v));
    };
    const toggle = () => {
      if (on) ctx.onKeys(null);                       // back to a plain constant
      else ctx.onKeys([[t, ctx.constVal]]);           // first key where the playhead is
    };
    const dropKey = () => ctx.onKeys(removeKeyAt(keys, t));

    const btn = (label2, title, active, onClick, extra) => React.createElement('button', {
      onClick, title,
      style: Object.assign({
        fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, lineHeight: 1,
        padding: '3px 5px', borderRadius: 3, cursor: 'pointer',
        background: active ? '#5cc8e8' : '#22252a', color: active ? '#07272f' : '#75777d',
        border: '1px solid ' + (active ? '#5cc8e8' : '#33363c')
      }, extra || {})
    }, label2);

    const track = on ? React.createElement('div', {
      style: { position: 'relative', height: 9, marginTop: 2, background: '#0f1113', border: '1px solid #26292f', borderRadius: 2 }
    },
      React.createElement('div', {
        style: { position: 'absolute', left: (t * 100) + '%', top: -1, bottom: -1, width: 1, background: '#4a4f57' }
      }),
      keys.map((k, i) => React.createElement('div', {
        key: i,
        title: 'key at ' + k[0].toFixed(3) + ' = ' + (Math.round(k[1] * 10000) / 10000),
        onClick: () => this.setState({ playing: false, t: k[0] }),
        style: {
          position: 'absolute', left: 'calc(' + (k[0] * 100) + '% - 3px)', top: 1,
          width: 6, height: 6, borderRadius: 3, cursor: 'pointer',
          background: Math.abs(k[0] - t) <= 0.0005 ? '#e7e5e2' : '#5cc8e8'
        }
      }))
    ) : null;

    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 } },
        React.createElement('span', { style: { fontSize: 11.5, color: '#c9c7c4', lineHeight: 1.2, flex: 1, minWidth: 0 } }, label),
        btn('\u25C6', on ? 'Keyframed - click to go back to a fixed value' : 'Keyframe this over the loop', on, toggle),
        on ? btn('\u2715', here ? 'Remove the key at the playhead' : 'No key at the playhead', false, dropKey,
          { opacity: here ? 1 : 0.35 }) : null,
        React.createElement('input', {
          type: 'number', value: shown, min, max, step, onChange: change,
          style: { width: 52, background: '#0f1113', color: '#e7e5e2', border: '1px solid #2c2f35', borderRadius: 3, padding: '3px 6px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, textAlign: 'right' }
        })
      ),
      React.createElement('input', { type: 'range', min, max, step, value: shown, onChange: change, style: { width: '100%', margin: 0, height: 14 } }),
      track
    );
  }

  /* Keys for a preset parameter live on the preset itself, so they travel with
     saves and the JSON without any extra plumbing. */
  pctx(name) {
    const S = this.state, p = S[S.preset];
    return {
      constVal: p[name],
      keys: (p._keys || {})[name] || null,
      onConst: (v) => this.setState({ [S.preset]: Object.assign({}, p, { [name]: v }) }, () => this.syncJson()),
      onKeys: (k) => {
        const _keys = Object.assign({}, p._keys || {});
        if (k) _keys[name] = k; else delete _keys[name];
        const next = Object.assign({}, p);
        if (Object.keys(_keys).length) next._keys = _keys; else delete next._keys;
        this.setState({ [S.preset]: next }, () => this.syncJson());
      }
    };
  }

  mctx(name) {
    const S = this.state;
    return {
      constVal: S[name],
      keys: (S.masterKeys || {})[name] || null,
      onConst: (v) => this.setState({ [name]: v }, () => this.syncJson()),
      onKeys: (k) => {
        const mk = Object.assign({}, S.masterKeys || {});
        if (k) mk[name] = k; else delete mk[name];
        this.setState({ masterKeys: mk }, () => this.syncJson());
      }
    };
  }

  slider(label, val, min, max, step, onChange) {
    return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 } },
        React.createElement('span', { style: { fontSize: 11.5, color: '#c9c7c4', lineHeight: 1.2 } }, label),
        React.createElement('input', {
          type: 'number', value: val, min, max, step, onChange,
          style: { width: 58, background: '#0f1113', color: '#e7e5e2', border: '1px solid #2c2f35', borderRadius: 3, padding: '3px 6px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, textAlign: 'right' }
        })
      ),
      React.createElement('input', { type: 'range', min, max, step, value: val, onChange, style: { width: '100%', margin: 0, height: 14 } })
    );
  }

  select(label, val, options, onChange) {
    return this.row(label, React.createElement('select', {
      value: val, onChange,
      style: { width: '100%', background: '#0f1113', color: '#e7e5e2', border: '1px solid #2c2f35', borderRadius: 3, padding: '5px 7px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5 }
    }, options.map((o) => React.createElement('option', { key: String(o), value: o }, String(o)))));
  }

  check(label, val, onChange) {
    return React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: '#c9c7c4', cursor: 'pointer' } },
      React.createElement('input', { type: 'checkbox', checked: !!val, onChange, style: { accentColor: '#5cc8e8', width: 14, height: 14 } }),
      label);
  }

  presetControls() {
    const S = this.state, p = S[S.preset], sp = this.setP, ps = this.setPS;
    const c = [];
    if (S.preset === 'rain') {
      c.push(this.kslider('Particle count', 1, 300, 1, this.pctx('count')));
      c.push(this.kslider('Scale min (× W)', 0.02, 0.4, 0.005, this.pctx('scaleMin')));
      c.push(this.kslider('Scale max (× W)', 0.02, 0.6, 0.005, this.pctx('scaleMax')));
      c.push(this.kslider('Fall speed tiers (int)', 1, 6, 1, this.pctx('tiers')));
      c.push(this.kslider('Sway amount', 0, 0.3, 0.005, this.pctx('sway')));
      c.push(this.kslider('Rotation ±°', 0, 45, 1, this.pctx('rot')));
      c.push(this.kslider('Opacity min', 0, 1, 0.01, this.pctx('opMin')));
      c.push(this.kslider('Opacity max', 0, 1, 0.01, this.pctx('opMax')));
      c.push(this.kslider('Depth fade', 0, 1, 0.05, this.pctx('depthFade')));
      c.push(this.kslider('Wind (× W per loop, int)', -4, 4, 1, this.pctx('wind')));
      c.push(this.kslider('Density bias to start', 0, 1, 0.05, this.pctx('bias')));
      c.push(this.select('Direction', p.dir, ['down', 'up', 'left', 'right'], ps('dir')));
      c.push(this.check('Mirroring', p.mirror, this.toggleP('mirror')));
      c.push(this.check('Additive glow', p.glow, this.toggleP('glow')));
    } else if (S.preset === 'scrollV' || S.preset === 'scrollH') {
      c.push(this.kslider('Tile size (× W)', 0.1, 2, 0.01, this.pctx('tileScale')));
      c.push(this.kslider('Tiles per loop (int)', 1, 8, 1, this.pctx('tiles')));
      c.push(this.kslider('Drift angle °', -45, 45, 1, this.pctx('angle')));
      c.push(this.select('Direction', p.dir, S.preset === 'scrollV' ? ['down', 'up'] : ['left', 'right'], ps('dir')));
      c.push(this.check('Parallax layer', p.parallax, this.toggleP('parallax')));
      if (p.parallax) {
        c.push(this.kslider('Parallax rate (int ×)', 1, 6, 1, this.pctx('pRate')));
        c.push(this.kslider('Parallax tile scale', 0.2, 1.5, 0.02, this.pctx('pScale')));
        c.push(this.kslider('Parallax opacity', 0, 1, 0.05, this.pctx('pOpacity')));
      }
    } else if (S.preset === 'orbit') {
      c.push(this.kslider('Count', 1, 60, 1, this.pctx('count')));
      c.push(this.kslider('Size (× W)', 0.02, 0.6, 0.005, this.pctx('size')));
      c.push(this.kslider('Radius X (× W)', 0, 0.6, 0.005, this.pctx('radiusX')));
      c.push(this.kslider('Radius Y (× H)', 0, 0.6, 0.005, this.pctx('radiusY')));
      c.push(this.kslider('Depth swing', 0, 1, 0.05, this.pctx('depth')));
      c.push(this.kslider('Opacity at back', 0, 1, 0.05, this.pctx('opMin')));
      c.push(this.kslider('Speed tiers (int)', 1, 4, 1, this.pctx('tiers')));
      c.push(this.kslider('Rotation ±°', 0, 45, 1, this.pctx('rot')));
      c.push(this.select('Direction', p.dir, ['cw', 'ccw'], ps('dir')));
    } else if (S.preset === 'fly') {
      c.push(this.kslider('Count', 1, 120, 1, this.pctx('count')));
      c.push(this.kslider('Spread', 0.05, 1.2, 0.01, this.pctx('spread')));
      c.push(this.kslider('Scale at distance', 0.005, 0.3, 0.005, this.pctx('startScale')));
      c.push(this.kslider('Scale at camera', 0.1, 2, 0.05, this.pctx('endScale')));
      c.push(this.kslider('Approach curve', 0.5, 5, 0.1, this.pctx('curve')));
      c.push(this.kslider('Fade in/out', 0.02, 0.49, 0.01, this.pctx('fade')));
      c.push(this.kslider('Speed tiers (int)', 1, 4, 1, this.pctx('tiers')));
      c.push(this.kslider('Rotation ±°', 0, 180, 1, this.pctx('rot')));
    } else if (S.preset === 'ripple') {
      c.push(this.kslider('Columns', 1, 12, 1, this.pctx('cols')));
      c.push(this.kslider('Rows', 1, 16, 1, this.pctx('rows')));
      c.push(this.kslider('Size (of cell)', 0.1, 1.4, 0.02, this.pctx('size')));
      c.push(this.kslider('Pulse amount', 0, 1, 0.01, this.pctx('amount')));
      c.push(this.kslider('Cycles per loop (int)', 1, 6, 1, this.pctx('cycles')));
      c.push(this.kslider('Falloff from centre', 0, 4, 0.05, this.pctx('falloff')));
      c.push(this.kslider('Opacity dip', 0, 1, 0.05, this.pctx('fade')));
    } else if (S.preset === 'radial') {
      c.push(this.kslider('Count', 1, 24, 1, this.pctx('count')));
      c.push(this.kslider('Radius (× W)', 0, 0.6, 0.005, this.pctx('radius')));
      c.push(this.kslider('Size (× W)', 0.02, 0.6, 0.005, this.pctx('size')));
      c.push(this.kslider('Spin (segments/loop, int)', 0, 8, 1, this.pctx('spin')));
      c.push(this.select('Direction', p.dir, ['cw', 'ccw'], ps('dir')));
      c.push(this.check('Face outward', p.faceOut, this.toggleP('faceOut')));
    } else if (S.preset === 'flag') {
      c.push(this.kslider('Fit (× canvas)', 0.2, 0.95, 0.01, this.pctx('fit')));
      c.push(this.kslider('Strips', 4, 120, 1, this.pctx('strips')));
      c.push(this.kslider('Amplitude', 0, 0.3, 0.005, this.pctx('amp')));
      c.push(this.kslider('Waves across', 0, 5, 0.1, this.pctx('waves')));
      c.push(this.kslider('Cycles per loop (int)', 1, 6, 1, this.pctx('cycles')));
      c.push(this.kslider('Taper from edge', 0, 1, 0.05, this.pctx('taper')));
      c.push(this.select('Strip axis', p.axis, ['x', 'y'], ps('axis')));
    } else if (S.preset === 'path') {
      c.push(this.kslider('Fit (× canvas)', 0.1, 0.95, 0.01, this.pctx('fit')));
      c.push(this.select('Loop', p.loop, ['ping-pong', 'closed', 'restart'], ps('loop')));
      c.push(this.kslider('Spin (turns/loop, int)', 0, 4, 1, this.pctx('spin')));
      c.push(this.check('Face along path', p.orient, this.toggleP('orient')));
      c.push(this.pathEditor());
      c.push(React.createElement('div', { 'data-wide': true, style: { fontSize: 11, lineHeight: 1.5, color: '#75777d' } },
        p.loop === 'closed'
          ? 'Closed: the two ends are one point, so dragging either moves the join and the whole loop with it. Drag the curve itself to move everything.'
          : p.loop === 'restart'
            ? 'Restart: one pass from end to end, then a hard cut back to the start. This is the one loop mode that does not join up, so the seam will show — which is the point when you want something to enter over and over.'
            : 'Ping-pong: the sprite runs out along the curve and back, which is what closes the loop. Drag the curve itself to move everything.'));
    } else {
      c.push(this.kslider('Fit (× canvas)', 0.2, 0.95, 0.01, this.pctx('fit')));
      if (S.preset === 'bob') {
        c.push(this.kslider('Bob amount (× H)', 0, 0.25, 0.005, this.pctx('amp')));
        c.push(this.kslider('Squash at bottom', 0, 0.3, 0.005, this.pctx('squash')));
      }
      if (S.preset === 'breathe') c.push(this.kslider('Breathe amount', 0, 0.25, 0.005, this.pctx('amount')));
      if (S.preset === 'sway') c.push(this.kslider('Sway ±°', 0, 30, 0.5, this.pctx('deg')));
      if (S.preset === 'float') {
        c.push(this.kslider('Bob amount (× H)', 0, 0.2, 0.005, this.pctx('amp')));
        c.push(this.kslider('Drift X (× W)', 0, 0.2, 0.005, this.pctx('driftX')));
        c.push(this.kslider('Drift Y (× H)', 0, 0.2, 0.005, this.pctx('driftY')));
        c.push(this.kslider('Lissajous cycles X (int)', 1, 5, 1, this.pctx('cyclesX')));
        c.push(this.kslider('Lissajous cycles Y (int)', 1, 5, 1, this.pctx('cyclesY')));
      }
      if (S.preset === 'tumble') {
        c.push(this.kslider('Turns per loop (int)', 0, 4, 1, this.pctx('turns')));
        c.push(this.kslider('Drift X (× W)', 0, 0.4, 0.005, this.pctx('driftX')));
        c.push(this.kslider('Drift Y (× H)', 0, 0.4, 0.005, this.pctx('driftY')));
        c.push(this.kslider('Drift cycles X (int)', 1, 4, 1, this.pctx('cyclesX')));
        c.push(this.kslider('Drift cycles Y (int)', 1, 4, 1, this.pctx('cyclesY')));
        c.push(this.select('Direction', p.dir, ['cw', 'ccw'], ps('dir')));
      }
      if (S.preset === 'pop') {
        c.push(this.kslider('Overshoot', 0, 0.6, 0.01, this.pctx('overshoot')));
        c.push(this.kslider('Rise (of loop)', 0.05, 0.6, 0.01, this.pctx('rise')));
        c.push(this.kslider('Hold (of loop)', 0, 0.9, 0.01, this.pctx('hold')));
        c.push(React.createElement('div', { style: { fontSize: 11, lineHeight: 1.5, color: '#75777d' } },
          'The tail after rise + hold scales back to zero so render(0) matches render(1).'));
      }
    }
    return c.map((el, i) => React.createElement('div', {
      key: i,
      style: el && el.props && el.props['data-wide'] ? { gridColumn: '1 / -1' } : null
    }, el));
  }

  /* The same drag mechanics as the easing editor, but the curve is where the
     sprite goes rather than how fast. Drawn at the canvas aspect so the path
     you see is the path you get. */
  pathEditor() {
    const S = this.state, p = S.path, P = this.pathPoints(p);
    const closed = p.loop === 'closed';
    /* The view runs past the canvas on every side, so points can be dragged
       off-canvas and still be grabbable. The inner rect is the canvas. */
    const LO = -0.45, HI = 1.45, SPAN = HI - LO;
    const aspect = S.cw / S.ch;
    const W = 250, H = Math.round(clamp(W / aspect, 110, 320));
    const X = (v) => ((v - LO) / SPAN) * W;
    const Y = (v) => ((v - LO) / SPAN) * H;
    const toX = (px) => LO + (px / W) * SPAN;
    const toY = (py) => LO + (py / H) * SPAN;
    const round = (v) => Math.round(v * 1000) / 1000;

    /* idx null drags the whole path. In closed mode the two ends are the same
       point, so moving one moves the other. */
    const grab = (idx) => (e) => {
      e.preventDefault();
      const svg = e.currentTarget.ownerSVGElement;
      const r0 = svg.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, pts: this.state.path.pts.slice() };
      const move = (ev) => {
        const r = svg.getBoundingClientRect() || r0;
        const dx = ((ev.clientX - start.x) / r.width) * SPAN;
        const dy = ((ev.clientY - start.y) / r.height) * SPAN;
        const pts = start.pts.slice();
        if (idx === null) {
          for (let i = 0; i < 8; i += 2) {
            pts[i] = round(clamp(start.pts[i] + dx, LO, HI));
            pts[i + 1] = round(clamp(start.pts[i + 1] + dy, LO, HI));
          }
        } else {
          const nx = round(clamp(toX((ev.clientX - r.left) / r.width * W), LO, HI));
          const ny = round(clamp(toY((ev.clientY - r.top) / r.height * H), LO, HI));
          pts[idx * 2] = nx; pts[idx * 2 + 1] = ny;
          if (closed && (idx === 0 || idx === 3)) { pts[0] = nx; pts[1] = ny; pts[6] = nx; pts[7] = ny; }
        }
        this.setState({ path: Object.assign({}, this.state.path, { pts }) }, () => this.syncJson());
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };

    const line = [];
    for (let i = 0; i <= 90; i++) {
      const pt = bezPoint(P, i / 90);
      line.push(X(pt[0]) + ',' + Y(pt[1]));
    }
    const head = bezPoint(P, this.pathU(p, frac(S.t)));
    const dot = (i, fill) => React.createElement('circle', {
      key: 'p' + i, cx: X(P[i * 2]), cy: Y(P[i * 2 + 1]), r: 6.5, fill,
      style: { cursor: 'grab' }, onPointerDown: grab(i)
    });

    return React.createElement('svg', {
      'data-wide': true, width: '100%', viewBox: '0 0 ' + W + ' ' + H,
      style: { background: '#0f1113', border: '1px solid #2a2d33', borderRadius: 3, touchAction: 'none', display: 'block', width: '100%' }
    },
      // Everything outside this rect is off-canvas and will not be rendered.
      React.createElement('rect', { x: X(0), y: Y(0), width: X(1) - X(0), height: Y(1) - Y(0), fill: '#141619', stroke: '#2f333a' }),
      React.createElement('line', { x1: X(P[0]), y1: Y(P[1]), x2: X(P[2]), y2: Y(P[3]), stroke: '#4a4f57', strokeDasharray: '3 3' }),
      React.createElement('line', { x1: X(P[6]), y1: Y(P[7]), x2: X(P[4]), y2: Y(P[5]), stroke: '#4a4f57', strokeDasharray: '3 3' }),
      // A fat transparent copy of the curve is the grab target for moving it all.
      React.createElement('polyline', {
        points: line.join(' '), fill: 'none', stroke: 'transparent', strokeWidth: 14,
        style: { cursor: 'move' }, onPointerDown: grab(null)
      }),
      React.createElement('polyline', { points: line.join(' '), fill: 'none', stroke: '#5cc8e8', strokeWidth: 1.8, style: { pointerEvents: 'none' } }),
      React.createElement('circle', { cx: X(head[0]), cy: Y(head[1]), r: 4, fill: '#e7e5e2', style: { pointerEvents: 'none' } }),
      dot(0, '#5cc8e8'),
      dot(1, '#e0b64a'),
      dot(2, '#e0b64a'),
      dot(3, closed ? '#2f7f96' : '#5cc8e8')
    );
  }


  bezierEditor() {
    const b = this.state.bez, W = 250, H = 150, pad = 18;
    const X = (v) => pad + v * (W - pad * 2), Y = (v) => H - pad - v * (H - pad * 2);
    const drag = (idx) => (e) => {
      e.preventDefault();
      const svg = e.currentTarget.ownerSVGElement;
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const x = clamp(((ev.clientX - r.left) / r.width * W - pad) / (W - pad * 2), 0, 1);
        const y = clamp((H - pad - (ev.clientY - r.top) / r.height * H) / (H - pad * 2), -0.6, 1.6);
        const nb = this.state.bez.slice();
        nb[idx * 2] = Math.round(x * 100) / 100; nb[idx * 2 + 1] = Math.round(y * 100) / 100;
        this.setState({ bez: nb }, () => this.syncJson());
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    const custom = this.state.ease === 'custom';
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const x = i / 60;
      pts.push(X(x) + ',' + Y(clamp(this.ease(x), -0.6, 1.6)));
    }
    const handles = custom ? [
      React.createElement('line', { key: 'h1', x1: X(0), y1: Y(0), x2: X(b[0]), y2: Y(b[1]), stroke: '#4a4f57' }),
      React.createElement('line', { key: 'h2', x1: X(1), y1: Y(1), x2: X(b[2]), y2: Y(b[3]), stroke: '#4a4f57' }),
      React.createElement('circle', { key: 'c1', cx: X(b[0]), cy: Y(b[1]), r: 6, fill: '#e0b64a', style: { cursor: 'grab' }, onPointerDown: drag(0) }),
      React.createElement('circle', { key: 'c2', cx: X(b[2]), cy: Y(b[3]), r: 6, fill: '#e0b64a', style: { cursor: 'grab' }, onPointerDown: drag(1) })
    ] : null;
    const ns = 'http://www.w3.org/2000/svg';
    return React.createElement('svg', { width: '100%', viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', style: { background: '#0f1113', border: '1px solid #2a2d33', borderRadius: 3, touchAction: 'none', display: 'block', width: '100%', height: '100%', maxHeight: 300 } },
      React.createElement('rect', { x: pad, y: pad, width: W - pad * 2, height: H - pad * 2, fill: 'none', stroke: '#23262b' }),
      React.createElement('line', { x1: X(0), y1: Y(0), x2: X(1), y2: Y(1), stroke: '#23262b', strokeDasharray: '3 3' }),
      React.createElement('polyline', { points: pts.join(' '), fill: 'none', stroke: custom ? '#5cc8e8' : '#8b8d93', strokeWidth: 1.6 }),
      handles
    );
  }

  renderVals() {
    const S = this.state;
    const frames = this.frames();
    const presetLabel = (PRESETS.find((p) => p[0] === S.preset) || ['', ''])[1];
    const stepBy = (d) => () => this.setState({ playing: false, t: frac((Math.round(S.t * frames) + d) / frames) });
    const setCanvasPreset = (e) => {
      const v = e.target.value, dims = CANVAS_PRESETS[v];
      this.setState(dims ? { canvasPreset: v, cw: dims[0], ch: dims[1] } : { canvasPreset: v }, () => this.syncJson());
    };
    return {
      mainRef: this.mainRef, thumbRef: this.thumbRef, detectRef: this.detectRef, srcImgRef: this.srcImgRef,
      checkerImage: 'linear-gradient(45deg,#1b1d21 25%,transparent 25%),linear-gradient(-45deg,#1b1d21 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1b1d21 75%),linear-gradient(-45deg,transparent 75%,#1b1d21 75%)',
      cw: S.cw, ch: S.ch, fps: S.fps, frameCount: frames,
      presetLabel, presetLabelUpper: presetLabel.toUpperCase(),
      srcName: S.srcName, srcDims: S.srcDims,
      onFile: (e) => this.onFileLoad(e.target.files && e.target.files[0]),
      onDragOver: (e) => e.preventDefault(),
      onDrop: (e) => {
        e.preventDefault();
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && /image\//.test(file.type)) this.onFileLoad(file);
      },
      noImage: !this.sprites, hasImage: !!this.sprites,
      playing: S.playing, playLabel: S.playing ? '❙❙ pause' : '▶ play',
      togglePlay: () => this.setState({ playing: !S.playing }),
      stepBack: stepBy(-1), stepFwd: stepBy(1),
      onScrub: (e) => this.setState({ playing: false, t: Number(e.target.value) }),
      tVal: S.t, tLabel: S.t.toFixed(3), frameLabel: Math.round(S.t * frames) + '/' + frames,
      hasUpdate: !!S.update,
      updateLabel: S.update ? 'Version ' + S.update.version + ' is available' : '',
      openUpdate: () => { if (NATIVE && NATIVE.openReleasePage) NATIVE.openReleasePage(); },
      dismissUpdate: () => this.setState({ update: null }),
      skipUpdate: () => {
        const v = S.update && S.update.version;
        if (v && NATIVE && NATIVE.skipUpdate) NATIVE.skipUpdate(v);
        this.setState({ update: null });
      },
      seamCheck: S.seamCheck, toggleSeam: () => this.setState({ seamCheck: !S.seamCheck }),

      presetList: PRESETS.map(([k, label]) => React.createElement('button', {
        key: k,
        onClick: () => this.setState({ preset: k }, () => this.syncJson()),
        style: {
          textAlign: 'left', fontFamily: "'IBM Plex Mono',monospace", fontSize: 11.5, padding: '7px 10px',
          background: S.preset === k ? '#5cc8e8' : '#1b1e22', color: S.preset === k ? '#07272f' : '#c9c7c4',
          border: '1px solid ' + (S.preset === k ? '#5cc8e8' : '#2a2d33'), borderRadius: 3, cursor: 'pointer',
          fontWeight: S.preset === k ? 500 : 400
        }
      }, label)),

      isHearts: S.sliceMode === 'hearts', isGrid: S.sliceMode === 'grid', isDetect: S.sliceMode === 'detect',
      ctlSliceMode: this.select('Mode', S.sliceMode, ['whole', 'grid', 'detect'],
        (e) => this.setState({ sliceMode: e.target.value }, () => { this.slice(); this.syncJson(); })),
      ctlRows: this.slider('Rows', S.rows, 1, 8, 1, (e) => this.setState({ rows: Math.round(Number(e.target.value)) }, () => this.slice())),
      ctlCols: this.slider('Columns', S.cols, 1, 8, 1, (e) => this.setState({ cols: Math.round(Number(e.target.value)) }, () => this.slice())),
      ctlMinArea: this.slider('Min region area %', S.minArea, 0.05, 5, 0.05, (e) => this.setState({ minArea: Number(e.target.value) })),
      runDetect: () => this.detect(),
      acceptDetect: () => this.pending && this.setState({ detected: this.pending, detectSummary: 'using ' + this.pending.length + ' region(s)' }, () => this.slice()),
      detectSummary: S.detectSummary,
      sliceCount: this.sprites ? this.sprites.length : 0,
      baseDims: this.baseW ? this.baseW + '×' + this.baseH : '—',

      ctlCanvasPreset: this.select('Canvas', S.canvasPreset, Object.keys(CANVAS_PRESETS), setCanvasPreset),
      ctlCw: this.slider('W', S.cw, 128, 2160, 2, this.set('cw')),
      ctlCh: this.slider('H', S.ch, 128, 2160, 2, this.set('ch')),
      ctlDuration: this.slider('Loop duration (s)', S.duration, 0.25, 6, 0.25, this.set('duration')),
      ctlFps: this.select('fps', S.fps, [24, 30, 60], this.set('fps')),
      ctlSpeed: this.slider('Master speed (preview)', S.speed, 0.25, 3, 0.05, this.set('speed')),
      ctlAmp: this.kslider('Master amplitude', 0, 2, 0.05, this.mctx('amp')),
      ctlScale: this.kslider('Master scale', 0.1, 3, 0.05, this.mctx('scale')),
      ctlSeed: this.row('Seed', React.createElement('input', {
        type: 'number', value: S.seed,
        onChange: (e) => this.setState({ seed: Math.round(Number(e.target.value)) || 0 }, () => { this.build(); this.syncJson(); }),
        style: { width: '100%', boxSizing: 'border-box', background: '#0f1113', color: '#e7e5e2', border: '1px solid #2c2f35', borderRadius: 3, padding: '5px 7px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }
      })),
      ctlOffX: this.kslider('Offset X', -0.5, 0.5, 0.005, this.mctx('offX')),
      ctlOffY: this.kslider('Offset Y', -0.5, 0.5, 0.005, this.mctx('offY')),
      recentre: () => {
        const mk = Object.assign({}, S.masterKeys || {});
        delete mk.offX; delete mk.offY;
        this.setState({ offX: 0, offY: 0, masterKeys: mk }, () => this.syncJson());
      },
      isOffset: S.offX !== 0 || S.offY !== 0 ||
        !!(S.masterKeys && (S.masterKeys.offX || S.masterKeys.offY)),
      reroll: () => this.setState({ seed: Math.floor(Math.random() * 100000) }, () => { this.build(); this.syncJson(); }),

      ctlEase: this.select('Curve', S.ease, ['linear', 'ease-in-out', 'elastic', 'custom'],
        (e) => this.setState({ ease: e.target.value }, () => this.syncJson())),
      isCustomEase: S.ease === 'custom',
      bezierEditor: this.bezierEditor(),
      bezLabel: S.ease === 'custom' ? 'cubic-bezier(' + S.bez.join(', ') + ') · drag the handles' : S.ease + ' · switch to custom to edit',

      presetControls: this.presetControls(),
      showTileWarn: (S.preset === 'scrollV' || S.preset === 'scrollH') && S.borderPct !== null && S.borderPct > 2,
      showTileOk: (S.preset === 'scrollV' || S.preset === 'scrollH') && S.borderPct !== null && S.borderPct <= 2,
      borderPctLabel: S.borderPct === null ? '—' : (S.borderPct > 0 && S.borderPct < 1 ? S.borderPct.toFixed(1) : Math.round(S.borderPct)) + '%',

      ctlBg: this.select('Mode', S.bg, ['transparent', 'color', 'image'], (e) => this.setState({ bg: e.target.value })),
      isBgColor: S.bg === 'color', isBgImage: S.bg === 'image',
      bgColor: S.bgColor, onBgColor: (e) => this.setState({ bgColor: e.target.value }),
      bgImageLabel: S.bgImageName,
      onBgFile: (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const img = new Image();
        img.onload = () => { this.bgImg = img; this.setState({ bgImageName: f.name }); };
        img.src = URL.createObjectURL(f);
      },

      exportName: this.name(),
      pngTarget: NATIVE ? 'folder' : 'zip',
      exportPng: this.exportPng,
      busy: S.busy, progressWidth: Math.round(S.progress * 100) + '%', progressLabel: S.progressLabel,
      hasFfmpeg: !!S.ffmpegCmd, ffmpegCmd: S.ffmpegCmd,

      saveName: S.saveName,
      onSaveName: (e) => this.setState({ saveName: e.target.value }),
      saveCount: S.saves.length ? S.saves.length + ' saved' : '',
      noSaves: S.saves.length === 0,
      saveCurrent: async () => {
        const snap = this.snapshot();
        const label = (PRESETS.find((x) => x[0] === snap.preset) || ['', snap.preset])[1];
        const name = (S.saveName || '').trim() || label + ' ' + (S.saves.length + 1);
        if (NATIVE && NATIVE.looks) {
          await NATIVE.looks.save({
            name, snap,
            imageName: S.srcName,
            // The artwork goes with it, so the look reloads complete.
            imageBytes: this.srcBytes || null
          });
          this.setState({ saveName: '' });
          return this.refreshLooks();
        }
        this.persist([{ id: Date.now(), name, snap }].concat(S.saves));
        this.setState({ saveName: '' });
      },
      importLook: async () => {
        if (!(NATIVE && NATIVE.looks)) return;
        try {
          const res = await NATIVE.looks.importOne();
          if (res && res.rec) await this.refreshLooks();
        } catch (err) { alert('Could not import that file: ' + (err && err.message ? err.message : err)); }
      },
      canImport: !!(NATIVE && NATIVE.looks),
      saves: S.saves.map((rec) => ({
        name: rec.name,
        meta: (PRESETS.find((x) => x[0] === rec.snap.preset) || ['', rec.snap.preset])[1] + ' · ' + rec.snap.cw + '×' + rec.snap.ch + ' · ' + rec.snap.duration + 's ' + rec.snap.fps + 'fps' + (rec.hasImage ? ' · with artwork' : ''),
        canExport: !!(NATIVE && NATIVE.looks),
        exportOne: async () => {
          if (!(NATIVE && NATIVE.looks)) return;
          try { await NATIVE.looks.exportOne(rec.id, rec.name); }
          catch (err) { alert('Could not export that look: ' + (err && err.message ? err.message : err)); }
        },
        load: () => {
          const s = rec.snap;
          const patch = {
            preset: s.preset, duration: s.duration, fps: s.fps, cw: s.cw, ch: s.ch,
            canvasPreset: s.canvasPreset || 'custom', speed: s.speed, amp: s.amp,
            seed: s.seed, ease: s.ease, bez: s.bez.slice(), sliceMode: s.sliceMode,
            detected: s.detected || null,
            detectSummary: s.detected ? 'using ' + s.detected.length + ' region(s)' : 'not run',
            rows: s.rows === undefined ? this.state.rows : s.rows,
            cols: s.cols === undefined ? this.state.cols : s.cols,
            minArea: s.minArea === undefined ? this.state.minArea : s.minArea,
            scale: s.scale || 1, offX: s.offX || 0, offY: s.offY || 0,
            masterKeys: s.masterKeys || {}
          };
          patch[s.preset] = Object.assign({}, this.state[s.preset], s.params);
          const apply = () => this.setState(patch, () => { this.build(); this.slice(); this.syncJson(); });
          if (NATIVE && NATIVE.looks && rec.hasImage) {
            // Bring the artwork back first; adopt() resets slicing, so the
            // settings have to land after it.
            NATIVE.looks.load(rec.id).then((res) => {
              if (res && res.imageBytes) {
                this.pendingLook = apply;
                this.loadImageBytes(res.rec.imageName || 'saved.png', res.imageBytes);
              } else apply();
            }).catch(apply);
          } else apply();
        },
        remove: async () => {
          if (NATIVE && NATIVE.looks) { await NATIVE.looks.remove(rec.id); return this.refreshLooks(); }
          this.persist(S.saves.filter((x) => x.id !== rec.id));
        }
      })),
      jsonText: S.jsonText, jsonHint: S.jsonHint,
      onJsonEdit: (e) => this.setState({ jsonText: e.target.value }),
      applyJson: () => {
        try {
          const o = JSON.parse(S.jsonText);
          const patch = {};
          ['preset', 'duration', 'fps', 'speed', 'amp', 'scale', 'seed', 'offX', 'offY', 'masterKeys', 'ease', 'sliceMode'].forEach((k) => { if (o[k] !== undefined) patch[k] = o[k]; });
          if (Array.isArray(o.canvas)) { patch.cw = o.canvas[0]; patch.ch = o.canvas[1]; patch.canvasPreset = 'custom'; }
          if (Array.isArray(o.bez)) patch.bez = o.bez;
          const target = o.preset || S.preset;
          if (o.params && S[target]) patch[target] = Object.assign({}, S[target], o.params);
          this.setState(patch, () => { this.build(); this.slice(); this.setState({ jsonHint: 'Applied.' }); });
        } catch (err) {
          this.setState({ jsonHint: 'Parse error: ' + err.message });
        }
      }
    };
  }
}

