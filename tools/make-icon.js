/*
 * Builds build/icon.ico from the project logo, with no image dependencies.
 *
 * PNG decode and encode both ride on core zlib; downsampling is a box filter
 * over premultiplied alpha, which keeps the dark outline from bleeding into the
 * transparent margin at small sizes. Vista and later read PNG-compressed ICO
 * entries directly, so no BMP path is needed.
 *
 *   node tools/make-icon.js [source.png]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.resolve(ROOT, process.argv[2] || 'PNG2ANIMATION.png');
const SIZES = [256, 128, 64, 48, 32, 16];

/* ---------- PNG decode (8-bit RGB/RGBA, non-interlaced) ---------- */

function decodePng(buf) {
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');

  let width = 0, height = 0, channels = 0;
  const idat = [];
  let offset = 8;
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.slice(offset + 4, offset + 8).toString('ascii');
    const data = buf.slice(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8], colorType = data[9], interlace = data[12];
      if (depth !== 8) throw new Error('only 8-bit PNGs are supported (got ' + depth + ')');
      if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
      if (colorType === 6) channels = 4;
      else if (colorType === 2) channels = 3;
      else throw new Error('only RGB/RGBA PNGs are supported (colour type ' + colorType + ')');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    raw.copy(line, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));

    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        throw new Error('unknown PNG filter ' + filter + ' on row ' + y);
      }
      line[i] = (line[i] + add) & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const s = x * channels, d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    line.copy(prev);
  }

  return { width, height, rgba: out };
}

/* ---------- trim + resize ---------- */

/* Drop the fully transparent margin so the artwork fills the icon square. */
function trimAlpha(img) {
  let top = img.height, left = img.width, right = -1, bottom = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.rgba[(y * img.width + x) * 4 + 3] < 8) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (right < 0) return img;

  // Keep it square and centred so nothing is stretched.
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  const half = Math.max(right - left, bottom - top) / 2;
  const x0 = Math.max(0, Math.round(cx - half));
  const y0 = Math.max(0, Math.round(cy - half));
  const size = Math.min(Math.round(half * 2) + 1, img.width - x0, img.height - y0);

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    img.rgba.copy(rgba, y * size * 4, ((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + size) * 4);
  }
  return { width: size, height: size, rgba };
}

/* Box filter over premultiplied alpha. */
function resize(img, size) {
  const out = Buffer.alloc(size * size * 4);
  const scale = img.width / size;
  for (let y = 0; y < size; y++) {
    const sy0 = Math.floor(y * scale), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < size; x++) {
      const sx0 = Math.floor(x * scale), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < img.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < img.width; sx++) {
          const i = (sy * img.width + sx) * 4;
          const al = img.rgba[i + 3] / 255;
          r += img.rgba[i] * al;
          g += img.rgba[i + 1] * al;
          b += img.rgba[i + 2] * al;
          a += al;
          n++;
        }
      }
      const d = (y * size + x) * 4;
      if (a > 0) {
        out[d] = Math.round(r / a);
        out[d + 1] = Math.round(g / a);
        out[d + 2] = Math.round(b / a);
      }
      out[d + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/* ---------- PNG / ICO encode ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);  // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

/* ---------- run ---------- */

const source = trimAlpha(decodePng(fs.readFileSync(SOURCE)));
const entries = SIZES.map((size) => ({ size, png: encodePng(resize(source, size), size) }));

const buildDir = path.join(ROOT, 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'icon.ico'), encodeIco(entries));
fs.writeFileSync(path.join(buildDir, 'icon.png'), entries[0].png);

console.log('source          ' + path.basename(SOURCE) + '  ' + source.width + 'x' + source.height + ' after trim');
console.log('build/icon.ico  ' + SIZES.join(', ') + '  (' +
  (fs.statSync(path.join(buildDir, 'icon.ico')).size / 1024).toFixed(1) + ' KB)');
