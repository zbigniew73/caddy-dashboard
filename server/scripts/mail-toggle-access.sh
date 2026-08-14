#!/usr/bin/env bash
#
# Wlacza/wylacza dostep do poczty (Dovecot/IMAP) dla pojedynczego konta
# hostingowego, NIE ruszajac jego dostepu SSH. Dovecot ma WLASNY plik PAM
# (/etc/pam.d/dovecot, ustawiany przez mail-install.sh) - odrebny od
# /etc/pam.d/sshd/system-auth uzywanego przez SSH - wiec blokujemy tam,
# zamiast przez usermod -L / passwd -l, co zablokowaloby tez SSH.
#
# Mechanizm: pam_listfile.so w /etc/pam.d/dovecot odrzuca logowanie kazdego
# uzytkownika wypisanego w /etc/dovecot/mail-disabled.list (jeden login na
# linie, plik moze byc pusty = wszyscy maja dostep). Idempotentne -
# "enable" usuwa wpis jesli istnieje, "disable" dopisuje go jesli go
# jeszcze nie ma.
#
# SAMONAPRAWCZE: jesli linia pam_listfile w /etc/pam.d/dovecot jeszcze nie
# istnieje (instalacja Poczty sprzed dodania tej funkcji), dopisuje ja
# przed reszta pracy - nie trzeba ponownie uruchamiac calego
# mail-install.sh na juz dzialajacej instalacji.
#
# Uzycie: mail-toggle-access.sh <username> <enable|disable>

set -euo pipefail

USERNAME="${1:-}"
ACTION="${2:-}"

if ! [[ "$USERNAME" =~ ^srv_[0-9]+$ ]]; then
  echo "BLAD: nieprawidlowa nazwa uzytkownika: '${USERNAME}'" >&2
  exit 1
fi
if ! id -u "$USERNAME" >/dev/null 2>&1; then
  echo "BLAD: uzytkownik '${USERNAME}' nie istnieje." >&2
  exit 1
fi
if [ "$ACTION" != "enable" ] && [ "$ACTION" != "disable" ]; then
  echo "BLAD: nieznana akcja '${ACTION}' (oczekiwano enable|disable)." >&2
  exit 1
fi

PAM_DOVECOT="/etc/pam.d/dovecot"
LISTFILE="/etc/dovecot/mail-disabled.list"

if [ ! -f "$PAM_DOVECOT" ]; then
  echo "BLAD: ${PAM_DOVECOT} nie istnieje - Poczta (Postfix/Dovecot) jest jeszcze niezainstalowana." >&2
  exit 1
fi

if ! grep -q 'pam_listfile.so' "$PAM_DOVECOT" 2>/dev/null; then
  sed -i "/^account[[:space:]]\+include[[:space:]]\+system-auth/i account    required     pam_listfile.so item=user sense=deny file=${LISTFILE} onerr=succeed" "$PAM_DOVECOT"
fi

mkdir -p "$(dirname "$LISTFILE")"
touch "$LISTFILE"
chmod 644 "$LISTFILE"

if [ "$ACTION" = "disable" ]; then
  if ! grep -qx "$USERNAME" "$LISTFILE" 2>/dev/null; then
    echo "$USERNAME" >> "$LISTFILE"
  fi
  echo "OK: dostep do poczty wylaczony dla ${USERNAME}."
else
  if grep -qx "$USERNAME" "$LISTFILE" 2>/dev/null; then
    sed -i "/^${USERNAME}\$/d" "$LISTFILE"
  fi
  echo "OK: dostep do poczty wlaczony dla ${USERNAME}."
fi
