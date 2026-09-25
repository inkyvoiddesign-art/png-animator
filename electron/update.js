/*
 * Update check.
 *
 * One anonymous GET to the public GitHub releases API, from the main process
 * so the renderer's CSP stays closed and the page itself never reaches the
 * network. Nothing is sent but the request: no identifier, no version, no
 * telemetry. The only thing GitHub learns is that some IP asked which release
 * is latest, and the user can switch it off entirely.
 *
 * Failure is always silent. Someone offline, behind a proxy, or rate-limited
 * should see the app start normally, not an error about a check they did not
 * ask for.
 */
const { net } = require('electron');

const LATEST = 'https://api.github.com/repos/inkyvoiddesign-art/png-animator/releases/latest';
const RELEASES_PAGE = 'https://github.com/inkyvoiddesign-art/png-animator/releases/latest';
const TIMEOUT_MS = 6000;

/* "v1.2.3" -> [1,2,3]. Anything unparseable sorts as 0.0.0 and so never wins. */
function parseVersion(tag) {
  const m = String(tag || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}

function isNewer(candidate, current) {
  const a = parseVersion(candidate), b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function fetchLatest() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };

    const req = net.request({ method: 'GET', url: LATEST });
    // GitHub rejects API requests without one.
    req.setHeader('User-Agent', 'PNG-Animator');
    req.setHeader('Accept', 'application/vnd.github+json');

    const timer = setTimeout(() => { try { req.abort(); } catch (e) {} done(reject, new Error('timed out')); }, TIMEOUT_MS);

    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.resume();
        return done(reject, new Error('HTTP ' + res.statusCode));
      }
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 400000) { try { req.abort(); } catch (e) {} } });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const json = JSON.parse(body);
          done(resolve, { tag: json.tag_name, url: json.html_url || RELEASES_PAGE });
        } catch (err) {
          done(reject, err);
        }
      });
    });
    req.on('error', (err) => { clearTimeout(timer); done(reject, err); });
    req.end();
  });
}

/*
 * Resolves { available, version, url } when there is something newer, or null
 * when there is not, when the check failed, or when the user has skipped this
 * version. Never rejects.
 */
async function check(currentVersion, skippedVersion) {
  try {
    const latest = await fetchLatest();
    if (!latest || !latest.tag) return null;
    if (!isNewer(latest.tag, currentVersion)) return null;
    const version = String(latest.tag).replace(/^v/i, '');
    if (skippedVersion && skippedVersion === version) return null;
    return { available: true, version, url: latest.url };
  } catch (err) {
    return null;
  }
}

module.exports = { check, isNewer, parseVersion, RELEASES_PAGE };
