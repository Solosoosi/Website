// Builds a static, single-page version of the site for GitHub Pages into docs/.
//
// There is no server on GitHub Pages, so:
//   - free times are calculated in the browser from the opening hours in config/site.json
//   - booking requests and contact messages are sent to the practitioner on WhatsApp
//
// Usage: npm run build:pages            (writes docs/)
//        node scripts/build-pages.mjs <out-dir>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'docs'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function replaceOnce(src, from, to) {
  if (!src.includes(from)) throw new Error(`build-pages: expected to find ${JSON.stringify(from.slice(0, 80))}`);
  return src.replace(from, () => to);
}

// Turn an ES module into plain script text: drop imports, keep exported declarations.
function stripModule(js) {
  return js.replace(/^import[\s\S]*?from\s+'[^']+';\n/gm, '').replace(/^export /gm, '');
}

function between(html, re, what) {
  const m = html.match(re);
  if (!m) throw new Error(`build-pages: could not find ${what}`);
  return m[1];
}

// ---------- HTML ----------

const index = read('public/index.html');
const book = read('public/book.html');
const mainOf = (html, what) => between(html, /<main id="main">([\s\S]*?)\n  <\/main>/, `<main> in ${what}`);

const header = between(index, /( {2}<header class="site-header">[\s\S]*?<\/header>)/, 'header');
const footer = between(index, /( {2}<footer class="site-footer">[\s\S]*?<\/footer>)/, 'footer');
const fab = between(index, /( {2}<a class="whatsapp-fab"[^\n]*<\/a>)/, 'WhatsApp button');
const bookMain = replaceOnce(
  mainOf(book, 'book.html'),
  '<a class="btn btn-outline" href="/book" data-i18n="book.another">',
  '<a class="btn btn-outline" href="#book" id="book-another" data-i18n="book.another">',
);

let body = `  <a class="skip-link" href="#main" data-i18n="a11y.skip"></a>
${header}
  <main id="main">
    <div id="page-home">${mainOf(index, 'index.html')}
    </div>
    <div id="page-book" hidden>${bookMain}
    </div>
  </main>
${footer}
${fab}`;
body = body.replaceAll('href="/book"', 'href="#book"').replaceAll('href="/"', 'href="#top"');
const absolute = body.match(/href="\/[^"]*"/g);
if (absolute) throw new Error(`build-pages: absolute links left: ${absolute.join(', ')}`);

// ---------- JS ----------

const config = JSON.parse(read('config/site.json'));

let site = read('public/js/site.js');
site = replaceOnce(site, 'export function loadConfig()', 'function serverLoadConfig()');
site = replaceOnce(site, 'export async function api(', 'async function serverApi(');

let home = stripModule(read('public/js/home.js'));
home = replaceOnce(
  home,
  "{ class: 'btn btn-outline btn-sm', href: `/book?service=${encodeURIComponent(s.id)}` }",
  "{ class: 'btn btn-outline btn-sm', href: '#book', 'data-service': s.id }",
);

let bookJs = stripModule(read('public/js/book.js'));
bookJs = replaceOnce(bookJs, "new URLSearchParams(location.search).get('service')", 'null');
bookJs += `
window.__bookPreset = (id) => {
  const s = state.config?.services.find((x) => x.id === id);
  if (s) {
    selectService(s);
    goTo(2, { focus: false });
  }
};
window.__bookReset = () => {
  confirmed = null;
  state.service = null;
  state.date = null;
  state.time = null;
  $('details-form').reset();
  $('booking-flow').hidden = false;
  document.querySelector('.page-hero').hidden = false;
  $('confirmation').hidden = true;
  renderAll();
  goTo(1, { focus: false });
};
`;

const staticBackend = `
// ---- Static backend: everything runs in the browser ----
const STATIC_CONFIG = ${JSON.stringify(config)};
let staticConfigPromise = null;
function loadConfig() {
  staticConfigPromise ??= Promise.resolve().then(() => {
    siteConfig = {
      business: STATIC_CONFIG.business,
      services: STATIC_CONFIG.services,
      currency: STATIC_CONFIG.currency,
      timezone: STATIC_CONFIG.timezone,
      today: nowInZone(STATIC_CONFIG.timezone).date,
      maxDaysAhead: STATIC_CONFIG.defaultSchedule.maxDaysAhead,
      handoff: 'whatsapp',
    };
    applyTranslations();
    return siteConfig;
  });
  return staticConfigPromise;
}
async function api(url) {
  const u = new URL(url, location.href);
  if (u.pathname.endsWith('/api/availability')) {
    const schedule = STATIC_CONFIG.defaultSchedule;
    const service = STATIC_CONFIG.services.find((s) => s.id === u.searchParams.get('service'));
    const now = nowInZone(STATIC_CONFIG.timezone);
    const last = addDays(now.date, schedule.maxDaysAhead);
    let from = u.searchParams.get('from');
    let to = u.searchParams.get('to');
    if (from < now.date) from = now.date;
    if (to > last) to = last;
    const days = {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      days[d] = slotsForDay({ date: d, duration: service.duration, schedule, now });
    }
    return { days };
  }
  const err = new Error('not_available_on_static_site');
  err.status = 404;
  err.data = {};
  throw err;
}
`;

const router = `
// ---- Router: #book shows the booking page, anything else the home page ----
{
  const home = document.getElementById('page-home');
  const bookPage = document.getElementById('page-book');
  let pendingService = null;
  function route() {
    const h = location.hash.slice(1);
    const isBook = h === 'book';
    home.hidden = isBook;
    bookPage.hidden = !isBook;
    document.body.dataset.titleKey = isBook ? 'meta.bookTitle' : 'meta.homeTitle';
    applyTranslations();
    if (isBook) {
      window.scrollTo({ top: 0 });
      if (pendingService) {
        const id = pendingService;
        pendingService = null;
        loadConfig().then(() => window.__bookPreset(id));
      }
    } else if (h && h !== 'top' && h !== 'main') {
      document.getElementById(h)?.scrollIntoView();
    } else {
      window.scrollTo({ top: 0 });
    }
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href === '#main') return;
    e.preventDefault();
    if (a.id === 'book-another') window.__bookReset();
    if (a.dataset.service) pendingService = a.dataset.service;
    if (location.hash === href) route();
    else location.hash = href;
  });
  window.addEventListener('hashchange', route);
  route();
}
`;

const script = [
  stripModule(read('public/js/i18n.js')),
  stripModule(read('public/js/icons.js')),
  stripModule(read('server/time.js')),
  stripModule(read('server/availability.js')),
  staticBackend,
  stripModule(site),
  `{\n${home}\n}`,
  `{\n${bookJs}\n}`,
  router,
].join('\n');

// Hebrew only; theme from the visitor's saved choice or device setting.
const themeInit = `(function () {
  var r = document.documentElement, th = null;
  try { th = localStorage.getItem('theme'); } catch (e) {}
  if (th !== 'light' && th !== 'dark') th = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  r.setAttribute('data-theme', th);
  r.lang = 'he';
  r.dir = 'rtl';
})();`;

const name = config.business.name.he;
const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  <meta name="description" content="">
  <meta name="theme-color" content="#4f6b55">
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <script>${themeInit}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&family=Frank+Ruhl+Libre:wght@400;500;700&display=swap">
  <style>
${read('public/css/styles.css')}
  </style>
</head>
<body data-title-key="meta.homeTitle">
${body}
  <script type="module">
${script}
  </script>
</body>
</html>
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'index.html'), html);
fs.copyFileSync(path.join(root, 'public', 'favicon.svg'), path.join(outDir, 'favicon.svg'));
fs.writeFileSync(path.join(outDir, '.nojekyll'), '');
console.log(`Built ${path.relative(root, outDir) || '.'}/index.html (${Math.round(html.length / 1024)} KB)`);
