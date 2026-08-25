/*
 * One-shot importer: turns the Claude Design self-extracting HTML export into
 * the plain source tree this project builds from.
 *
 *   node tools/unpack-bundle.js "PNG Animator - blank start (offline).html"
 *
 * The export inlines every asset as gzipped base64 in a __bundler/manifest
 * block and keeps the real page in a __bundler/template block. We decode both,
 * write the assets out as ordinary files, rewrite the uuid references to
 * relative paths, and split the x-dc logic into its own editable .js file.
 *
 * Kept in the repo for provenance — re-run it only when re-importing a fresh
 * export from Claude Design. Day-to-day builds use tools/build-renderer.js.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const input = process.argv[2] || 'PNG Animator - blank start (offline).html';
const html = fs.readFileSync(path.join(ROOT, input), 'utf8');

function block(type) {
  const open = '<script type="__bundler/' + type + '">';
  const i = html.indexOf(open);
  if (i < 0) throw new Error('missing __bundler/' + type + ' block');
  const j = html.indexOf('</script>', i + open.length);
  return html.slice(i + open.length, j).trim();
}

const manifest = JSON.parse(block('manifest'));
const extResources = JSON.parse(block('ext_resources'));
let template = JSON.parse(block('template'));

// Friendly names for the two script assets we know by sight; everything else
// keeps its uuid, which is fine for fonts nobody reads by name.
const KNOWN = {
  'application/javascript': 'dc-runtime.js',
  'text/javascript': null
};
const byUrl = new Map(extResources.map((e) => [e.uuid, e.id]));

const rel = {};
for (const [uuid, entry] of Object.entries(manifest)) {
  let bytes = Buffer.from(entry.data, 'base64');
  if (entry.compressed) bytes = zlib.gunzipSync(bytes);

  let out;
  if (entry.mime.startsWith('font/')) {
    out = path.join('assets', 'fonts', uuid + '.woff2');
  } else if (byUrl.has(uuid)) {
    // React / ReactDOM UMD builds, pulled from their unpkg URL.
    out = path.join('vendor', path.basename(new URL(byUrl.get(uuid)).pathname));
  } else if (bytes.slice(0, 200).toString('utf8').includes('dc-runtime')) {
    out = path.join('vendor', 'dc-runtime.js');
  } else if (bytes.slice(0, 200).toString('utf8').includes('JSZip')) {
    out = path.join('vendor', 'jszip.min.js');
  } else {
    out = path.join('vendor', uuid + '.js');
  }

  const abs = path.join(SRC, out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  rel[uuid] = out.split(path.sep).join('/');
  console.log('  ' + rel[uuid].padEnd(42) + (bytes.length / 1024).toFixed(1) + ' KB');
}

// Point every uuid reference at the file we just wrote.
for (const [uuid, p] of Object.entries(rel)) template = template.split(uuid).join(p);

// The runtime resolves React/ReactDOM through window.__resources, falling back
// to the live unpkg URL when a mapping is absent. Map them to the local copies
// so the app never reaches for the network.
const resources = {};
for (const e of extResources) resources[e.id] = rel[e.uuid];
const shim =
  '\n<script>window.__resources = ' +
  JSON.stringify(resources, null, 2).replace(/<\//g, '<\\/') +
  ';</' + 'script>';
template = template.replace(/<head[^>]*>/i, (m) => m + shim);

// Split the x-dc logic out so it can be edited as ordinary JavaScript.
const openTag = /<script type="text\/x-dc"[^>]*>/.exec(template);
const bodyStart = openTag.index + openTag[0].length;
const bodyEnd = template.indexOf('</script>', bodyStart);
const appJs = template.slice(bodyStart, bodyEnd);

fs.writeFileSync(path.join(SRC, 'app.dc.js'), appJs.replace(/^\n/, ''));
fs.writeFileSync(
  path.join(SRC, 'index.template.html'),
  template.slice(0, bodyStart) + '\n/*{{APP_SCRIPT}}*/\n' + template.slice(bodyEnd)
);

console.log('\n  src/app.dc.js            ' + (appJs.length / 1024).toFixed(1) + ' KB');
console.log('  src/index.template.html  ' + (template.length / 1024).toFixed(1) + ' KB');
