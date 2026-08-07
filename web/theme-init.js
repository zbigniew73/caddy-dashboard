(function () {
  var saved = localStorage.getItem('cd-theme') || 'system';
  document.documentElement.setAttribute('data-theme', saved);
})();
