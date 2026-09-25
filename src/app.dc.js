const HEART_SLICES = [
  { x: 450, y: 141, w: 399, h: 335 },
  { x: 49,  y: 349, w: 399, h: 335 },
  { x: 450, y: 539, w: 479, h: 401 }
];
const HB_W = 399, HB_H = 335;

const PRESETS = [
  ['rain', 'Rain'], ['scrollV', 'Scroll · vertical'], ['scrollH', 'Scroll · horizontal'],
  ['bob', 'Idle bob'], ['breathe', 'Breathe'], ['sway', 'Sway'], ['float', 'Float'], ['pop', 'Pop']
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
    speed: 1, amp: 1, seed: 1337,
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
    busy: false, progress: 0, progressLabel: '', ffmpegCmd: '',
    saves: [], saveName: '',
    jsonText: '', jsonHint: 'Current preset + global settings. Edit and hit apply to restore a look.'
  };

  mainRef = React.createRef();
  srcImgRef = React.createRef();
  thumbRef = React.createRef();
  detectRef = React.createRef();

  componentDidMount() {
    this.raf = requestAnimationFrame(this.loop);
    try {
      const raw = localStorage.getItem('pngAnimator.saves');
      if (raw) this.setState({ saves: JSON.parse(raw) });
    } catch (e) {}
    if (NATIVE) this.offOpen = NATIVE.onOpenImage(({ name, bytes }) => this.loadImageBytes(name, bytes));
  }
  componentWillUnmount() { cancelAnimationFrame(this.raf); if (this.offOpen) this.offOpen(); }

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
    }, () => { this.slice(); this.build(); this.drawThumb(); this.syncJson(); });
  }

  loadImageBytes(name, bytes) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const img = new Image();
    img.onload = () => { this.adopt(img, name); URL.revokeObjectURL(url); };
    img.src = url;
  }

  onFileLoad = (file) => {
    if (!file) return;
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
    const t = this.ease(frac(rawT));
    const p = S[S.preset];
    if (S.preset === 'rain') return this.rRain(g, t, W, H, p);
    if (S.preset === 'scrollV' || S.preset === 'scrollH') return this.rScroll(g, t, W, H, p, S.preset === 'scrollV');
    return this.rSingle(g, t, W, H, p, S.preset);
  }

  rRain(g, t, W, H, p) {
    const S = this.state, A = S.amp;
    const horiz = p.dir === 'left' || p.dir === 'right';
    const count = Math.min(Math.round(p.count), this.parts.length);
    for (let i = 0; i < count; i++) {
      const q = this.parts[i];
      const sc = lerp(p.scaleMin, p.scaleMax, q.rScale);
      const w = W * sc, h = w * (this.baseH / this.baseW);
      const fade = lerp(1, q.rScale, clamp(p.depthFade, 0, 1));
      const op = clamp(lerp(p.opMin, p.opMax, fade), 0, 1);
      const rot = q.rRot * (p.rot * Math.PI / 180);
      const tier = 1 + (Math.floor(q.rTier * Math.max(1, Math.round(p.tiers))) % Math.max(1, Math.round(p.tiers)));
      const along = frac(Math.pow(q.phase, 1 + clamp(p.bias, 0, 1) * 2) + t * tier);
      const swayAmp = q.rSway * p.sway * W * A;
      const sway = swayAmp * Math.sin(TAU * (t * q.cycles + q.swayPhase));
      const wind = Math.round(p.wind) * t * (horiz ? H : W);
      let x, y;
      if (horiz) {
        const span = W + w, prog = p.dir === 'left' ? 1 - along : along;
        x = prog * span - w;
        y = frac((q.x0 * H + sway + wind) / (H + h)) * (H + h) - h / 2;
      } else {
        const span = H + h, prog = p.dir === 'up' ? 1 - along : along;
        y = prog * span - h;
        x = frac((q.x0 * W + sway + wind) / (W + w)) * (W + w) - w / 2;
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
      const tw = W * L.k, th = tw * (src.height / src.width);
      const cols = Math.ceil(W / tw) + 2, rows = Math.ceil(H / th) + 2;
      const sign = (vertical ? p.dir === 'up' : p.dir === 'left') ? -1 : 1;
      const prog = frac(t * L.rate) * sign;
      const main = vertical ? prog * th : prog * tw;
      const cross = vertical ? Math.tan(ang) * main : Math.tan(ang) * main;
      const ox = vertical ? frac(cross / tw) * tw : frac(main / tw) * tw;
      const oy = vertical ? frac(main / th) * th : frac(cross / th) * th;
      g.globalAlpha = L.a;
      for (let cx = -1; cx < cols; cx++)
        for (let cy = -1; cy < rows; cy++)
          g.drawImage(src, cx * tw + ox, cy * th + oy, tw, th);
      g.globalAlpha = 1;
    }
  }

  rSingle(g, t, W, H, p, preset) {
    const src = this.sprites[0], A = this.state.amp;
    const k = Math.min(W * 0.85 / src.width, H * 0.85 / src.height) * (p.fit / 0.7);
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
    g.translate(cx + dx, baseY + dy);
    g.rotate(rot);
    g.scale(sx, sy);
    g.drawImage(src, -w / 2, -h, w, h);
    g.restore();
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

  recordTo = async (mime, flatten, ext) => {
    if (this.state.busy) return;
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) {
      this.setState({ progressLabel: '' });
      alert(mime + ' is not supported in this browser. Use the PNG sequence.');
      return;
    }
    const S = this.state, fps = S.fps;
    const W = flatten ? S.cw - (S.cw % 2) : S.cw, H = flatten ? S.ch - (S.ch % 2) : S.ch;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { alpha: !flatten });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    const stream = cv.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12000000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    this.setState({ busy: true, progress: 0, progressLabel: 'encoding…', ffmpegCmd: '' });
    this.flatten = flatten ? 'flatten' : false;
    this.exporting = true;
    rec.start();
    const n = this.frames();
    for (let i = 0; i < n; i++) {
      this.render(g, i / n, W, H, true);
      track.requestFrame();
      this.setState({ progress: (i + 1) / n, progressLabel: 'frame ' + (i + 1) + ' / ' + n });
      await new Promise((r) => setTimeout(r, Math.max(8, 1000 / fps)));
    }
    rec.stop();
    await done;
    this.exporting = false; this.flatten = false;
    this.save(new Blob(chunks, { type: mime }), ext);
    this.setState({ busy: false, progressLabel: '' });
  };

  /*
   * Same story as the MP4 below — MediaRecorder timestamps by wall clock and
   * silently drops frames it can't keep up with, which for a loop is worse
   * than the wrong frame rate: a dropped frame is missing animation. The
   * catch is transparency. Chromium's VideoEncoder refuses alpha:'keep' for
   * every codec, so WebM alpha has to be a second encoded stream carried
   * beside the colour one; mediabunny does that split and the muxing, and its
   * add() resolves on encoder backpressure, so nothing is ever dropped.
   */
  exportWebm = async () => {
    if (this.state.busy) return;
    const S = this.state, fps = S.fps, MB = window.Mediabunny;
    if (!MB) {
      await this.recordTo('video/webm;codecs=vp9', false, '.webm');
      this.setState({ ffmpegCmd: 'Recorded without mediabunny — this file has a variable frame rate and may be missing frames. Use the PNG sequence.' });
      return;
    }

    // Both the colour and alpha streams are 4:2:0, which halves the chroma
    // planes, so odd dimensions have nowhere to round to.
    const W = S.cw - (S.cw % 2), H = S.ch - (S.ch % 2);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { alpha: true });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';

    this.setState({ busy: true, progress: 0, progressLabel: 'encoding…', ffmpegCmd: '' });
    this.flatten = false; // transparency is the whole point of this export
    this.exporting = true;

    try {
      const output = new MB.Output({
        format: new MB.WebMOutputFormat(),
        target: new MB.BufferTarget()
      });
      const source = new MB.CanvasSource(cv, {
        codec: 'vp9', bitrate: 12000000, alpha: 'keep'
      });
      output.addVideoTrack(source, { frameRate: fps });
      await output.start();

      const n = this.frames();
      for (let i = 0; i < n; i++) {
        this.render(g, i / n, W, H, true);
        // Resolves once the encoder is ready for more, so the loop can never
        // outrun it and lose a frame.
        await source.add(i / fps, 1 / fps);
        this.setState({ progress: (i + 1) / n, progressLabel: 'frame ' + (i + 1) + ' / ' + n });
      }
      await output.finalize();
      this.save(new Blob([output.target.buffer], { type: 'video/webm' }), '.webm');
    } catch (err) {
      alert('WebM encoding failed: ' + (err && err.message ? err.message : err) +
        '\n\nExport the PNG sequence instead.');
    } finally {
      this.exporting = false; this.flatten = false;
      this.setState({ busy: false, progressLabel: '' });
    }
  };

  /*
   * MediaRecorder stamps each frame with the wall-clock moment requestFrame()
   * fired, and nothing in recordTo ever tells it a frame belongs at i/fps. The
   * setTimeout pacing is a floor with unbounded overshoot, so the stamps drift
   * and a "30fps" export measures about 29.58 — variable frame rate, which
   * Resolve and Premiere refuse. WebCodecs takes the presentation time as an
   * argument instead of inferring it, so the timestamps land exactly 1/fps
   * apart and the muxer writes a constant frame rate.
   */
  exportMp4 = async () => {
    if (this.state.busy) return;
    const S = this.state, fps = S.fps, MB = window.Mediabunny;
    if (!MB) {
      const m = ['video/mp4;codecs=avc1.42E01E', 'video/mp4']
        .find((x) => window.MediaRecorder && MediaRecorder.isTypeSupported(x));
      if (!m) { alert('MP4 export is not supported in this browser. Export the PNG sequence and run the ffmpeg command.'); return; }
      await this.recordTo(m, true, '.mp4');
      this.setState({ ffmpegCmd: 'Recorded without mediabunny — this file has a variable frame rate and may be missing frames. Use the PNG sequence.' });
      return;
    }

    const W = S.cw - (S.cw % 2), H = S.ch - (S.ch % 2); // H.264 needs even dimensions
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d', { alpha: false });
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';

    this.setState({ busy: true, progress: 0, progressLabel: 'encoding…', ffmpegCmd: '' });
    this.flatten = 'flatten'; // MP4 has no alpha, so composite the background
    this.exporting = true;

    try {
      const output = new MB.Output({
        format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }),
        target: new MB.BufferTarget()
      });
      const source = new MB.CanvasSource(cv, {
        codec: 'avc', bitrate: 12000000, alpha: 'discard'
      });
      output.addVideoTrack(source, { frameRate: fps });
      await output.start();

      const n = this.frames();
      for (let i = 0; i < n; i++) {
        this.render(g, i / n, W, H, true);
        await source.add(i / fps, 1 / fps);
        this.setState({ progress: (i + 1) / n, progressLabel: 'frame ' + (i + 1) + ' / ' + n });
      }
      await output.finalize();
      this.save(new Blob([output.target.buffer], { type: 'video/mp4' }), '.mp4');
    } catch (err) {
      alert('MP4 encoding failed: ' + (err && err.message ? err.message : err) +
        '\n\nExport the PNG sequence and run the ffmpeg command instead.');
    } finally {
      this.exporting = false; this.flatten = false;
      this.setState({ busy: false, progressLabel: '' });
    }
  };

  persist(saves) {
    this.setState({ saves });
    try { localStorage.setItem('pngAnimator.saves', JSON.stringify(saves)); } catch (e) {}
  }

  snapshot() {
    const S = this.state;
    return {
      preset: S.preset, duration: S.duration, fps: S.fps, cw: S.cw, ch: S.ch,
      canvasPreset: S.canvasPreset, speed: S.speed, amp: S.amp, seed: S.seed,
      ease: S.ease, bez: S.bez.slice(), sliceMode: S.sliceMode,
      params: Object.assign({}, S[S.preset])
    };
  }

  syncJson() {
    const S = this.state;
    this.setState({
      jsonText: JSON.stringify({
        preset: S.preset, duration: S.duration, fps: S.fps, canvas: [S.cw, S.ch],
        speed: S.speed, amp: S.amp, seed: S.seed, ease: S.ease, bez: S.bez,
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
      c.push(this.slider('Particle count', p.count, 1, 300, 1, sp('count')));
      c.push(this.slider('Scale min (× W)', p.scaleMin, 0.02, 0.4, 0.005, sp('scaleMin')));
      c.push(this.slider('Scale max (× W)', p.scaleMax, 0.02, 0.6, 0.005, sp('scaleMax')));
      c.push(this.slider('Fall speed tiers (int)', p.tiers, 1, 6, 1, sp('tiers')));
      c.push(this.slider('Sway amount', p.sway, 0, 0.3, 0.005, sp('sway')));
      c.push(this.slider('Rotation ±°', p.rot, 0, 45, 1, sp('rot')));
      c.push(this.slider('Opacity min', p.opMin, 0, 1, 0.01, sp('opMin')));
      c.push(this.slider('Opacity max', p.opMax, 0, 1, 0.01, sp('opMax')));
      c.push(this.slider('Depth fade', p.depthFade, 0, 1, 0.05, sp('depthFade')));
      c.push(this.slider('Wind (× W per loop, int)', p.wind, -4, 4, 1, sp('wind')));
      c.push(this.slider('Density bias to start', p.bias, 0, 1, 0.05, sp('bias')));
      c.push(this.select('Direction', p.dir, ['down', 'up', 'left', 'right'], ps('dir')));
      c.push(this.check('Mirroring', p.mirror, this.toggleP('mirror')));
      c.push(this.check('Additive glow', p.glow, this.toggleP('glow')));
    } else if (S.preset === 'scrollV' || S.preset === 'scrollH') {
      c.push(this.slider('Tile size (× W)', p.tileScale, 0.1, 2, 0.01, sp('tileScale')));
      c.push(this.slider('Tiles per loop (int)', p.tiles, 1, 8, 1, sp('tiles')));
      c.push(this.slider('Drift angle °', p.angle, -45, 45, 1, sp('angle')));
      c.push(this.select('Direction', p.dir, S.preset === 'scrollV' ? ['down', 'up'] : ['left', 'right'], ps('dir')));
      c.push(this.check('Parallax layer', p.parallax, this.toggleP('parallax')));
      if (p.parallax) {
        c.push(this.slider('Parallax rate (int ×)', p.pRate, 1, 6, 1, sp('pRate')));
        c.push(this.slider('Parallax tile scale', p.pScale, 0.2, 1.5, 0.02, sp('pScale')));
        c.push(this.slider('Parallax opacity', p.pOpacity, 0, 1, 0.05, sp('pOpacity')));
      }
    } else {
      c.push(this.slider('Fit (× canvas)', p.fit, 0.2, 0.95, 0.01, sp('fit')));
      if (S.preset === 'bob') {
        c.push(this.slider('Bob amount (× H)', p.amp, 0, 0.25, 0.005, sp('amp')));
        c.push(this.slider('Squash at bottom', p.squash, 0, 0.3, 0.005, sp('squash')));
      }
      if (S.preset === 'breathe') c.push(this.slider('Breathe amount', p.amount, 0, 0.25, 0.005, sp('amount')));
      if (S.preset === 'sway') c.push(this.slider('Sway ±°', p.deg, 0, 30, 0.5, sp('deg')));
      if (S.preset === 'float') {
        c.push(this.slider('Bob amount (× H)', p.amp, 0, 0.2, 0.005, sp('amp')));
        c.push(this.slider('Drift X (× W)', p.driftX, 0, 0.2, 0.005, sp('driftX')));
        c.push(this.slider('Drift Y (× H)', p.driftY, 0, 0.2, 0.005, sp('driftY')));
        c.push(this.slider('Lissajous cycles X (int)', p.cyclesX, 1, 5, 1, sp('cyclesX')));
        c.push(this.slider('Lissajous cycles Y (int)', p.cyclesY, 1, 5, 1, sp('cyclesY')));
      }
      if (S.preset === 'pop') {
        c.push(this.slider('Overshoot', p.overshoot, 0, 0.6, 0.01, sp('overshoot')));
        c.push(this.slider('Rise (of loop)', p.rise, 0.05, 0.6, 0.01, sp('rise')));
        c.push(this.slider('Hold (of loop)', p.hold, 0, 0.9, 0.01, sp('hold')));
        c.push(React.createElement('div', { style: { fontSize: 11, lineHeight: 1.5, color: '#75777d' } },
          'The tail after rise + hold scales back to zero so render(0) matches render(1).'));
      }
    }
    return c.map((el, i) => React.createElement('div', { key: i }, el));
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
      ctlAmp: this.slider('Master amplitude', S.amp, 0, 2, 0.05, this.set('amp')),
      ctlSeed: this.row('Seed', React.createElement('input', {
        type: 'number', value: S.seed,
        onChange: (e) => this.setState({ seed: Math.round(Number(e.target.value)) || 0 }, () => { this.build(); this.syncJson(); }),
        style: { width: '100%', boxSizing: 'border-box', background: '#0f1113', color: '#e7e5e2', border: '1px solid #2c2f35', borderRadius: 3, padding: '5px 7px', fontFamily: "'IBM Plex Mono',monospace", fontSize: 12 }
      })),
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
      exportPng: this.exportPng, exportWebm: this.exportWebm, exportMp4: this.exportMp4,
      busy: S.busy, progressWidth: Math.round(S.progress * 100) + '%', progressLabel: S.progressLabel,
      hasFfmpeg: !!S.ffmpegCmd, ffmpegCmd: S.ffmpegCmd,

      saveName: S.saveName,
      onSaveName: (e) => this.setState({ saveName: e.target.value }),
      saveCount: S.saves.length ? S.saves.length + ' saved' : '',
      noSaves: S.saves.length === 0,
      saveCurrent: () => {
        const snap = this.snapshot();
        const label = (PRESETS.find((x) => x[0] === snap.preset) || ['', snap.preset])[1];
        const name = (S.saveName || '').trim() || label + ' ' + (S.saves.length + 1);
        this.persist([{ id: Date.now(), name, snap }].concat(S.saves));
        this.setState({ saveName: '' });
      },
      saves: S.saves.map((rec) => ({
        name: rec.name,
        meta: (PRESETS.find((x) => x[0] === rec.snap.preset) || ['', rec.snap.preset])[1] + ' · ' + rec.snap.cw + '×' + rec.snap.ch + ' · ' + rec.snap.duration + 's ' + rec.snap.fps + 'fps · seed ' + rec.snap.seed,
        load: () => {
          const s = rec.snap;
          const patch = {
            preset: s.preset, duration: s.duration, fps: s.fps, cw: s.cw, ch: s.ch,
            canvasPreset: s.canvasPreset || 'custom', speed: s.speed, amp: s.amp,
            seed: s.seed, ease: s.ease, bez: s.bez.slice(), sliceMode: s.sliceMode
          };
          patch[s.preset] = Object.assign({}, this.state[s.preset], s.params);
          this.setState(patch, () => { this.build(); this.slice(); this.syncJson(); });
        },
        remove: () => this.persist(S.saves.filter((x) => x.id !== rec.id))
      })),
      jsonText: S.jsonText, jsonHint: S.jsonHint,
      onJsonEdit: (e) => this.setState({ jsonText: e.target.value }),
      applyJson: () => {
        try {
          const o = JSON.parse(S.jsonText);
          const patch = {};
          ['preset', 'duration', 'fps', 'speed', 'amp', 'seed', 'ease', 'sliceMode'].forEach((k) => { if (o[k] !== undefined) patch[k] = o[k]; });
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

