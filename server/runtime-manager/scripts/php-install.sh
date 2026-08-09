#!/usr/bin/env bash
#
# Instaluje jedna wersje PHP przez Remi SCL (VERSION w formacie dwoch
# cyfr, np. "85" -> pakiet php85). Idempotentne - bezpieczne do ponownego
# uruchomienia. Zaklada, ze repozytoria EPEL/Remi juz sa wlaczone
# (remi-setup-repos.sh, wolane osobno PRZED tym skryptem przez
# routes/php.js).

set -euo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]{2}$ ]] || err "Nieprawidlowy format wersji: '${VERSION}' (oczekiwano dwoch cyfr, np. 85)."

PKG="php${VERSION}"

rpm -q "$PKG" >/dev/null 2>&1 || dnf install -y "$PKG" \
  || err "Instalacja pakietu ${PKG} nie powiodla sie - sprawdz czy ta wersja jest dostepna w repozytorium Remi."

dnf install -y \
    "${PKG}-php-cli" \
    "${PKG}-php-fpm" \
    "${PKG}-php-common" \
    "${PKG}-php-opcache" \
    "${PKG}-php-mbstring" \
    "${PKG}-php-xml" \
    "${PKG}-php-curl" \
    "${PKG}-php-gd" \
    "${PKG}-php-intl" \
    "${PKG}-php-bcmath" \
    "${PKG}-php-zip" \
    "${PKG}-php-mysqlnd" \
    "${PKG}-php-pdo" \
    "${PKG}-php-soap" \
    "${PKG}-php-process" \
  || err "Instalacja rozszerzen ${PKG} nie powiodla sie."

SERVICE="${PKG}-php-fpm"
systemctl enable --now "$SERVICE" || err "Pakiety zainstalowane, ale nie udalo sie uruchomic/wlaczyc uslugi ${SERVICE}."

PHP_BIN="/opt/remi/${PKG}/root/usr/bin/php"
[ -x "$PHP_BIN" ] || err "Instalacja zakonczona, ale nie znaleziono binarki PHP pod ${PHP_BIN}."

WRAPPER="/usr/local/bin/${PKG}"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
exec "${PHP_BIN}" "\$@"
EOF
chmod 755 "$WRAPPER"

"$WRAPPER" -v >/dev/null 2>&1 || err "Instalacja zakonczona, ale '${PKG} -v' zwrocilo blad."

echo "OK: PHP ${VERSION:0:1}.${VERSION:1:1} zainstalowany i uruchomiony (usluga: ${SERVICE}, CLI: ${WRAPPER})."
