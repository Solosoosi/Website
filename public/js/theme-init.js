// Runs synchronously in <head> so the page never flashes the wrong theme, direction or text size.
(function () {
  var root = document.documentElement;
  var theme = 'light';
  var lang = 'he';
  root.classList.add('js');
  try {
    var saved = localStorage.getItem('theme');
    theme = saved === 'light' || saved === 'dark'
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    lang = new URLSearchParams(location.search).get('lang') || localStorage.getItem('lang') || 'he';
    var a11y = JSON.parse(localStorage.getItem('a11y') || '{}') || {};
    if (a11y.text) root.classList.add('a11y-text-' + a11y.text);
    ['contrast', 'links', 'still', 'font'].forEach(function (k) {
      if (a11y[k]) root.classList.add('a11y-' + k);
    });
  } catch (e) {}
  // ?options shows a bar for comparing the design options (and remembers the pick).
  try {
    if (/[?&]options(=|&|$)/.test(location.search)) {
      root.classList.add('show-looks');
      var look = localStorage.getItem('look');
      if (look === '2' || look === '3') root.setAttribute('data-look', look);
    }
  } catch (e) {}
  // The home page opens with a short intro – once per visit.
  try {
    if (sessionStorage.getItem('intro')) root.classList.add('no-intro');
    else sessionStorage.setItem('intro', '1');
  } catch (e) {}
  if (lang !== 'en') lang = 'he';
  root.setAttribute('data-theme', theme);
  root.lang = lang;
  root.dir = lang === 'he' ? 'rtl' : 'ltr';
})();
