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
  // The design: ערפל (mist).
  root.setAttribute('data-look', '2ln');
  // Phones: on the home page the bottom bar waits until the opening button scrolls away.
  if (location.pathname === '/' || /\/index\.html$/.test(location.pathname)) root.classList.add('bar-wait');
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
