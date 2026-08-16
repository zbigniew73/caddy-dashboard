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

// Sciezka BEZWZGLEDNA "/i18n/..." - PRAWDZIWA przyczyna calej serii bledow
// 2026-08-16 w koncu znaleziona i POTWIERDZONA w DevTools na zywym
// serwerze: panel usera stoi pod "/user/" (ze slashem), wiec wzgledny
// fetch "i18n/en.json" rozwiazywal sie do "/user/i18n/en.json" - istnial
// tam ZAPOMNIANY, nieaktualny duplikat (web/user/i18n/*.json, ostatnio
// modyfikowany 2026-08-15, zero nowych kluczy typu "Kopiuj DKIM") ktory
// express.static cicho serwowal (status 200, poprawny JSON, po prostu
// STARY) zamiast wlasciwego web/i18n/*.json. Panel admina (strona "/")
// nigdy tego nie mial, bo tam wzgledna sciezka trafia wprost we
// wlasciwy plik - stad admin dzialal poprawnie, user nie.
// Duplikat USUNIETY (byl caly czas martwy, nic go nie referencjonowalo),
// ALE sciezka bezwzgledna zostaje i tak - jedyny sposob zeby to samo NIE
// powtorzylo sie w przyszlosci dla jakiejkolwiek strony pod "/user/*".
// Potwierdzone NIEZALEZNIE przez `curl https://.../i18n/en.json` (ten sam,
// poprawny wynik) - bezwzgledna sciezka jest wiec zweryfikowana jako
// bezpieczna, nie tylko teoretyczna.
//
// `?v=${Date.now()}` - cache-buster, KAZDE zaladowanie strony wymusza
// swiezy fetch z serwera, ignorujac lokalny cache przegladarki (pliki sa
// male, koszt bandwidth pomijalny).
async function loadLangDict(lang) {
  const res = await fetch(`/i18n/${lang}.json?v=${Date.now()}`);
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
