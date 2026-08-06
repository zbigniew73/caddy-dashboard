# Caddy Dashboard

Nowe podejście do panelu zarządzania usługami na serwerze AlmaLinux/Rocky Linux 9/10, oparte na [Caddy](https://caddyserver.com/) jako reverse proxy.

## Status

Szkielet aplikacji (Node.js/Express): logowanie przez konta systemowe (PAM) oraz panel z jedną pozycją w menu — **System**. Reszta funkcji (zarządzanie Caddyfile, subdomenami, TLS) w trakcie ustalania.

## Cel

Panel webowy do zarządzania usługami wystawianymi przez Caddy na serwerze: subdomeny, reverse proxy, TLS, konfiguracja `Caddyfile`.

## Instalacja

```bash
npm install
cp .env.example .env
# uzupelnij AUTH_USERS i SESSION_SECRET w .env (patrz komentarze w pliku)
npm start
```

## Logowanie systemowe (PAM)

Logowanie odbywa się przez konta systemowe (login + hasło jak przy SSH), whitelistowane w `AUTH_USERS`. Proces `node` musi być rootem albo członkiem grupy `shadow`, inaczej PAM pozwoli sprawdzać tylko hasło własnego użytkownika procesu.

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
