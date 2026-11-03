import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Cloudflare build: pages with link previews, Hebrew only, security headers', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  execFileSync(process.execPath, ['scripts/build-cloudflare.mjs', out]);
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  const book = fs.readFileSync(path.join(out, 'book.html'), 'utf8');

  for (const [html, title] of [[index, 'טיפולי דיקור | דוד נאמן'], [book, 'קביעת טיפול | דוד נאמן']]) {
    assert.equal(html.match(/<title>/g).length, 1);
    assert.match(html, new RegExp(`<title>${title}</title>`));
    assert.match(html, /<meta name="description" content="[^"]{20,}">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/[^"]+\/images\/og\.jpg">/);
  }
  assert.ok(fs.existsSync(path.join(out, 'images', 'og.jpg')));
  const ld = JSON.parse(index.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.equal(ld['@type'], 'LocalBusiness');
  assert.ok(ld.openingHoursSpecification.length > 0);

  // Public pages stay in Hebrew; the admin panel keeps its language choice.
  const init = fs.readFileSync(path.join(out, 'js', 'theme-init.js'), 'utf8');
  assert.doesNotMatch(init, /get\('lang'\)/);
  assert.match(init, /\/\^\\\/admin\/\.test\(location\.pathname\)/);

  const headers = fs.readFileSync(path.join(out, '_headers'), 'utf8');
  assert.match(headers, /^\/\*\n {2}Content-Security-Policy: default-src 'self'; script-src 'self';/);
  assert.match(headers, /Strict-Transport-Security: max-age=31536000/);
  assert.match(headers, /\/admin\n {2}X-Robots-Tag: noindex/);
});
