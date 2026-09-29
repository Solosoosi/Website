// Runs synchronously in <head> so the page never flashes the wrong theme or direction.
(function () {
  var root = document.documentElement;
  var theme = 'light';
  var lang = 'he';
  try {
    var saved = localStorage.getItem('theme');
    theme = saved === 'light' || saved === 'dark'
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    lang = new URLSearchParams(location.search).get('lang') || localStorage.getItem('lang') || 'he';
  } catch (e) {}
  if (lang !== 'en') lang = 'he';
  root.setAttribute('data-theme', theme);
  root.lang = lang;
  root.dir = lang === 'he' ? 'rtl' : 'ltr';
})();
