// Тема ставится до отрисовки страницы, чтобы не мигал светлый фон.
(function () {
  var pref = 'auto';
  try { pref = localStorage.getItem('uniplan-theme') || 'auto'; } catch (e) { /* приватный режим */ }
  var dark = pref === 'dark' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';

  try {
    var accent = localStorage.getItem('uniplan-accent');
    if (accent && accent !== 'auto') {
      document.documentElement.dataset.accent = accent;
    }
  } catch (e) { /* приватный режим */ }
})();
