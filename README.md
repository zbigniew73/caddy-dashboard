# Caddy Dashboard v1.4.1

Nowe podejście do panelu zarządzania usługami na serwerze AlmaLinux/Rocky Linux 9/10, oparte na [Caddy](https://caddyserver.com/) jako reverse proxy.

## Status

Szkielet aplikacji (Node.js/Express): logowanie przez konta systemowe (PAM) oraz panel z jedną pozycją w menu — **System**. Reszta funkcji (zarządzanie Caddyfile, subdomenami, TLS) w trakcie ustalania.

## Cel

Panel webowy do zarządzania usługami wystawianymi przez Caddy na serwerze: subdomeny, reverse proxy, TLS, konfiguracja `Caddyfile`.

## Instalacja

### Na docelowym VPS (AlmaLinux/Rocky) - jedna komenda

```bash
curl -fsSL https://raw.githubusercontent.com/zbigniew73/caddy-dashboard/main/install.sh | sudo bash
```

Na starcie skrypt pyta o jezyk instalacji: `pl` albo `en` - trzeba wpisac
jeden z nich, dopiero wtedy leci reszta (pytanie i wszystkie kolejne
komunikaty sa w wybranym jezyku).

Skrypt (`install.sh`) wymaga AlmaLinux/Rocky Linux 9 lub 10, klonuje repo do
`/opt/caddy-dashboard`, instaluje Node.js 24 LTS (NodeSource) jesli brak lub
aktualizuje do 24 gdy jest inna wersja, instaluje Caddy (COPR), tworzy
dedykowanego uzytkownika `cdadmin` (patrz sekcja ponizej), robi
`npm install`, generuje `.env` (pyta o `AUTH_USERS`/`HOST`, `SESSION_SECRET`
generowany automatycznie), otwiera w firewalld http/https/ssh i port
dashboardu, oraz przygotowuje `caddy-dashboard.service`. Autostart (systemd)
zostawia do recznego wykonania - na koncu wypisuje dokladne komendy.

### Recznie (dowolna dystrybucja, np. do developmentu)

```bash
npm install
cp .env.example .env
# uzupelnij AUTH_USERS i SESSION_SECRET w .env (patrz komentarze w pliku)
npm start
```

## Logowanie systemowe (PAM + sudo)

Logowanie wymaga spełnienia trzech warunków naraz:
1. login jest na jawnej whiteliście `AUTH_USERS`,
2. hasło poprawnie weryfikuje się przez PAM (jak przy SSH),
3. konto należy do grupy `wheel` — do panelu logują się wyłącznie sudoerzy, bo zarządzają całym systemem i usługami.

Na AlmaLinux/Rocky proces `node` **nie musi** być rootem ani członkiem żadnej grupy `shadow` (tam takiej grupy zwykle w ogóle nie ma) - weryfikacja hasła idzie przez `/usr/sbin/unix_chkpwd`, binarkę z bitem `setuid root` (`-rwsr-xr-x`, potwierdzone na realnym systemie), która sama czyta `/etc/shadow` z uprawnieniami roota i zwraca tylko wynik. Zwykły user w grupie `wheel` wystarczy.

### Dedykowany użytkownik `cdadmin`

`install.sh` sprawdza, czy w systemie istnieje user `cdadmin` i proponuje go skonfigurować (albo utworzyć, jeśli nie istnieje) jako administratora panelu — zamiast logować się/uruchamiać usługę na koncie `root`:

- należy do grupy `wheel` (sudo, wymóg logowania do panelu i uruchamiania usługi - PAM na Alma/Rocky nie wymaga nic ponad to, patrz wyżej),
- tworzony bez katalogu domowego, z powłoką `/sbin/nologin` (brak bezpośredniego logowania po SSH — tylko przez panel + sudo),
- jeśli user jest tworzony od nowa, skrypt generuje losowe 12-znakowe hasło (wielkie/małe litery, cyfry, znaki specjalne) i zapisuje je w `/root/.usercd` (`chmod 600`, tylko root) — stamtąd trzeba je odczytać po instalacji,
- jeśli `cdadmin` jest gotowy, staje się domyślną propozycją zarówno dla `AUTH_USERS` w `.env`, jak i dla `User=` w `caddy-dashboard.service` (nadal można wpisać inne konto podczas pytań skryptu).

## Uruchamianie jako usluga systemd (autostart po restarcie)

```bash
cp caddy-dashboard.service.example caddy-dashboard.service
# domyslne WorkingDirectory/EnvironmentFile zakladaja instalacje w
# /opt/caddy-dashboard - podmien je tylko jesli u Ciebie jest inaczej.
# User zawsze trzeba ustawic na swoje konto.
sudo cp caddy-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now caddy-dashboard
```

Plik `caddy-dashboard.service` (z podmienionymi wartosciami) jest w `.gitignore` - zostaje lokalnie na serwerze, nie w repo.

## Struktura

```
server/
  index.js           Express: routing, tryb ekspozycji (local/lan/world), CSP
  routes/auth.js      /api/auth/login, /logout, /status
  routes/api.js        /api/system
  services/auth.js    PAM, sesja podpisywana HMAC
web/
  index.html          ekran logowania + powloka panelu (header, menu, tresc)
  app.js               logika frontu
  theme-init.js        motyw jasny/ciemny/systemowy
```
