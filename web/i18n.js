// Zeby dodac nowy jezyk: 1) skopiuj web/i18n/en.json na web/i18n/<kod>.json
// i przetlumacz wartosci, 2) dopisz <kod> do SUPPORTED_LANGS ponizej.
const SUPPORTED_LANGS = ['pl', 'en'];

let currentLang = 'en';
let dict = {};
let fallbackDict = {};

function detectDefaultLang() {
  const saved = localStorage.getItem('cd-lang');
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return SUPPORTED_LANGS.includes(browserLang) ? browserLang : 'en';
}

async function loadLangDict(lang) {
  const res = await fetch(`i18n/${lang}.json`);
  if (!res.ok) throw new Error(`Brak pliku tlumaczen dla jezyka: ${lang}`);
  return res.json();
}

async function setLanguage(lang) {
  if (!SUPPORTED_LANGS.includes(lang)) lang = 'en';
  currentLang = lang;
  localStorage.setItem('cd-lang', lang);

  if (fallbackDict.__loaded !== true) {
    fallbackDict = await loadLangDict('en');
    fallbackDict.__loaded = true;
  }
  dict = lang === 'en' ? fallbackDict : await loadLangDict(lang);

  document.documentElement.setAttribute('lang', lang);
  applyTranslations();
  if (typeof onLanguageChange === 'function') onLanguageChange();
}

function t(key, vars) {
  let str = dict[key] ?? fallbackDict[key] ?? key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
    });
  }
  return str;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  renderLangSwitches();
}

function renderLangSwitches() {
  document.querySelectorAll('.lang-switch').forEach((container) => {
    container.innerHTML = SUPPORTED_LANGS.map(
      (lang) => `<button type="button" class="lang-btn${lang === currentLang ? ' active' : ''}" data-lang="${lang}">${lang.toUpperCase()}</button>`
    ).join('<span class="lang-sep">|</span>');
    container.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.onclick = () => setLanguage(btn.dataset.lang);
    });
  });
}
