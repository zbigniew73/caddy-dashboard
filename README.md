# Caddy Dashboard

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

Skrypt (`install.sh`, szkielet - patrz komentarz na gorze pliku co jeszcze
niedopracowane) klonuje repo do `/opt/caddy-dashboard`, instaluje Node.js
jesli brak, robi `npm install`, generuje `.env` (pyta o `AUTH_USERS`/`HOST`,
`SESSION_SECRET` generowany automatycznie) i przygotowuje
`caddy-dashboard.service`. Autostart (systemd) i otwarcie portu w firewalld
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

Proces `node` musi być rootem albo członkiem grupy `shadow`, inaczej PAM pozwoli sprawdzać tylko hasło własnego użytkownika procesu.

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
