#!/usr/bin/env bash
#
# Ustawia dwa realne limity Postfixa - `mailbox_size_limit` (maks. rozmiar
# skrzynki, bajty, 0 = bez limitu) i `message_size_limit` (maks. rozmiar
# CALEJ wiadomosci wraz z zalacznikami - Postfix nie ma osobnego limitu
# "na zalacznik", to jedyny realny odpowiednik). Wartosci zapisywane
# przez `postconf -e` bezposrednio w /etc/postfix/main.cf, walidowane
# (`postfix check`) PRZED przeladowaniem - jesli walidacja sie nie
# powiedzie, przywraca poprzednie wartosci.
#
# Uzycie: postfix-set-limits.sh <mailbox_size_limit> <message_size_limit>
#   (oba w bajtach, liczby calkowite >= 0)

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

MAILBOX_LIMIT="${1:-}"
MESSAGE_LIMIT="${2:-}"

[[ "$MAILBOX_LIMIT" =~ ^[0-9]+$ ]] || err "nieprawidlowy mailbox_size_limit: '${MAILBOX_LIMIT}' (oczekiwano liczby calkowitej >= 0)."
[[ "$MESSAGE_LIMIT" =~ ^[0-9]+$ ]] || err "nieprawidlowy message_size_limit: '${MESSAGE_LIMIT}' (oczekiwano liczby calkowitej >= 0)."

OLD_MAILBOX="$(postconf -h mailbox_size_limit 2>/dev/null || true)"
OLD_MESSAGE="$(postconf -h message_size_limit 2>/dev/null || true)"

rollback() {
  [ -n "$OLD_MAILBOX" ] && postconf -e "mailbox_size_limit=${OLD_MAILBOX}" >/dev/null 2>&1
  [ -n "$OLD_MESSAGE" ] && postconf -e "message_size_limit=${OLD_MESSAGE}" >/dev/null 2>&1
  systemctl reload postfix >/dev/null 2>&1 || true
}

postconf -e "mailbox_size_limit=${MAILBOX_LIMIT}"
postconf -e "message_size_limit=${MESSAGE_LIMIT}"

if ! postfix check 2>/tmp/postfix-set-limits.err; then
  MSG="$(cat /tmp/postfix-set-limits.err 2>/dev/null)"
  rm -f /tmp/postfix-set-limits.err
  rollback
  err "Nowe limity nie przeszly 'postfix check': ${MSG} - przywrocono poprzednie wartosci."
fi
rm -f /tmp/postfix-set-limits.err

if ! systemctl reload postfix 2>/tmp/postfix-set-limits.err; then
  MSG="$(cat /tmp/postfix-set-limits.err 2>/dev/null)"
  rm -f /tmp/postfix-set-limits.err
  rollback
  err "Przeladowanie postfix z nowymi limitami nie powiodlo sie: ${MSG} - przywrocono poprzednie wartosci."
fi
rm -f /tmp/postfix-set-limits.err

echo "OK: mailbox_size_limit=${MAILBOX_LIMIT}, message_size_limit=${MESSAGE_LIMIT}."
