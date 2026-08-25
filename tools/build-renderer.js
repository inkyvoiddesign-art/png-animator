/*
 * Composes the renderer bundle the Electron shell loads.
 *
 * The dc-runtime reads the component logic from the *text content* of the
 * <script type="text/x-dc"> tag, so it cannot be an external file. This step
 * inlines src/app.dc.js into src/index.template.html and copies the static
 * assets alongside it, which keeps app.dc.js editable as ordinary JavaScript.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'renderer');
const MARKER = '/*{{APP_SCRIPT}}*/';

const template = fs.readFileSync(path.join(SRC, 'index.template.html'), 'utf8');
const app = fs.readFileSync(path.join(SRC, 'app.dc.js'), 'utf8');

if (!template.includes(MARKER)) throw new Error('index.template.html lost its ' + MARKER + ' marker');
if (app.includes('</script')) throw new Error('app.dc.js contains a </script> sequence and cannot be inlined');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), template.replace(MARKER, app));
for (const dir of ['vendor', 'assets']) {
  fs.cpSync(path.join(SRC, dir), path.join(OUT, dir), { recursive: true });
}

const size = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
console.log('renderer/index.html  ' + size(path.join(OUT, 'index.html')));
