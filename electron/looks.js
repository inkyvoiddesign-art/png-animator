/*
 * Saved looks on disk.
 *
 * These used to live in localStorage, which meant two things: they were capped
 * at a few megabytes, and they could only ever hold settings — nowhere near
 * enough room for the artwork itself. Reloading a look therefore gave you the
 * parameters back but not the PNG they were made for.
 *
 * Each look is now two files in userData/looks:
 *
 *   <id>.json   name, timestamp and settings — small, so listing reads only these
 *   <id>.png    the exact source image, byte for byte
 *
 * A look exports as one self-contained .pnganim file: the same JSON with the
 * image base64'd inside, so it can be handed to someone else or kept next to
 * the artwork it belongs to.
 */
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { app } = require('electron');

const EXT = '.pnganim';

function dir() {
  return path.join(app.getPath('userData'), 'looks');
}

async function ensureDir() {
  await fs.mkdir(dir(), { recursive: true });
}

function safeId(id) {
  // Ids are ours, but they arrive over IPC, so treat them as untrusted.
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '');
  return clean.length ? clean.slice(0, 64) : null;
}

/* Metadata only — the images are never read here, so this stays quick. */
async function list() {
  await ensureDir();
  let names;
  try { names = await fs.readdir(dir()); } catch (err) { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(dir(), name), 'utf8');
      const rec = JSON.parse(raw);
      if (!rec || !rec.id) continue;
      rec.hasImage = fsSync.existsSync(path.join(dir(), rec.id + '.png'));
      out.push(rec);
    } catch (err) { /* skip anything unreadable rather than failing the list */ }
  }
  out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return out;
}

async function save({ id, name, snap, imageName, imageBytes }) {
  await ensureDir();
  const rid = safeId(id) || ('look-' + Date.now().toString(36));
  const rec = {
    id: rid,
    name: String(name || 'Untitled').slice(0, 120),
    savedAt: Date.now(),
    imageName: imageName ? String(imageName).slice(0, 200) : null,
    snap: snap || {}
  };
  await fs.writeFile(path.join(dir(), rid + '.json'), JSON.stringify(rec, null, 2));
  if (imageBytes && imageBytes.length) {
    await fs.writeFile(path.join(dir(), rid + '.png'), Buffer.from(imageBytes));
  }
  return rec;
}

async function load(id) {
  const rid = safeId(id);
  if (!rid) throw new Error('bad look id');
  const rec = JSON.parse(await fs.readFile(path.join(dir(), rid + '.json'), 'utf8'));
  let imageBytes = null;
  try { imageBytes = await fs.readFile(path.join(dir(), rid + '.png')); } catch (err) { /* settings-only look */ }
  return { rec, imageBytes: imageBytes ? new Uint8Array(imageBytes) : null };
}

async function remove(id) {
  const rid = safeId(id);
  if (!rid) return;
  for (const f of [rid + '.json', rid + '.png']) {
    try { await fs.unlink(path.join(dir(), f)); } catch (err) { /* already gone */ }
  }
}

/* One portable file: settings plus the image, base64'd. */
async function exportTo(id, filePath) {
  const { rec, imageBytes } = await load(id);
  const payload = {
    format: 'png-animator-look',
    version: 1,
    name: rec.name,
    savedAt: rec.savedAt,
    imageName: rec.imageName,
    image: imageBytes ? Buffer.from(imageBytes).toString('base64') : null,
    snap: rec.snap
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  return { ok: true };
}

async function importFrom(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const p = JSON.parse(raw);
  if (!p || p.format !== 'png-animator-look') throw new Error('not a PNG Animator look file');
  if (!p.snap || typeof p.snap !== 'object') throw new Error('look file has no settings');
  const imageBytes = p.image ? new Uint8Array(Buffer.from(String(p.image), 'base64')) : null;
  return save({
    id: 'look-' + Date.now().toString(36),
    name: p.name || path.basename(filePath, EXT),
    snap: p.snap,
    imageName: p.imageName,
    imageBytes
  });
}

module.exports = { list, save, load, remove, exportTo, importFrom, EXT, dir };
