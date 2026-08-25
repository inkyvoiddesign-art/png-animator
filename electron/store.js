/* Tiny JSON store in userData — window geometry and last-used folders. */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const FILE = path.join(app.getPath('userData'), 'preferences.json');
let data = {};

try {
  data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('[store] ignoring unreadable preferences:', err.message);
}

let pending = null;
function flush() {
  pending = null;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[store] could not persist preferences:', err.message);
  }
}

module.exports = {
  get: (key, fallback) => (data[key] === undefined ? fallback : data[key]),
  set(key, value) {
    data[key] = value;
    // Window drags fire continuously; coalesce writes rather than hammering disk.
    if (!pending) pending = setTimeout(flush, 400);
  },
  flush() {
    if (pending) clearTimeout(pending);
    flush();
  }
};
