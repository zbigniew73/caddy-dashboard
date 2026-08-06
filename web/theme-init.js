// Ustawia motyw zanim strona sie wyrenderuje (zapobiega mrugnieciu jasnym tlem).
// Osobny plik, bo CSP zabrania skryptow inline.
(function () {
  var saved = localStorage.getItem('cd-theme') || 'system';
  document.documentElement.setAttribute('data-theme', saved);
})();
