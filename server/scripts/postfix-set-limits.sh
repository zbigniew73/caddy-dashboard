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
# SAMONAPRAWCZE (przy KAZDYM uruchomieniu): ustawia TEZ
# `virtual_mailbox_limit=${MAILBOX_LIMIT}` (dla wirtualnych domen/
# skrzynek, patrz [[project_caddy_dashboard_virtual_mail_plan]]) -
# Postfix ma dla niego WLASNY, STALY domyslny limit (51200000 B, ~51MB),
# NIEZALEZNY od mailbox_size_limit (mimo ze oba nazywaja sie podobnie) -
# jesli admin kiedykolwiek podniesie message_size_limit powyzej tej
# wartosci bez rownoczesnego dotkniecia virtual_mailbox_limit (co ten
# skrypt wczesniej w ogole nie robil), `postfix check` przechodzi CZYSTO,
# ale sam PROCES agenta `virtual` odmawia startu przy pierwszej realnej
# dostawie: "fatal: configuration error: virtual_mailbox_limit is smaller
# than message_size_limit" - i throttluje sie w kolko (`bad command
# startup -- throttling`), wiec KAZDA poczta do KAZDEJ wirtualnej
# skrzynki (i przychodzaca z internetu, i wewnetrzna) po cichu ginie,
# mimo ze admin nigdy nie dostal zadnego komunikatu bledu przy zapisie
# limitow. Potwierdzone na zywym serwerze 2026-08-15 (`postconf -h
# virtual_mailbox_limit` = 51200000, mimo mailbox_size_limit=512000000).
# Dostawa lokalna (`local`, konta systemowe/SSH) nie ma tej samej
# walidacji przy starcie, wiec ten bug byl caly czas niewidoczny, dopoki
# ktos faktycznie nie wyslal poczty na pierwsza realna wirtualna
# skrzynke.
#
# Uzycie: postfix-set-limits.sh <mailbox_size_limit> <message_size_limit>
#   (oba w bajtach, liczby calkowite >= 0)
#
# SAMONAPRAWCZE (przy okazji, przy KAZDYM uruchomieniu): ustawia tez
# home_mailbox=Maildir/, jesli jeszcze go nie ma - na instalacjach Poczty
# sprzed tej poprawki Postfix dorecza lokalna poczte do starego formatu
# mbox (/var/mail/<user>), a Dovecot/Roundcube czytaja z ~/Maildir - dwa
# rozne miejsca, wiadomosc "dostarczona" wedlug Postfixa, ale niewidoczna
# dla odbiorcy. Kliknij "Zapisz" na tym kafelku (nawet bez zmiany
# wartosci), zeby naprawic juz dzialajaca instalacje.
#
# Naprawia TEZ smtpd_milters/non_smtpd_milters z "inet:localhost:8891" na
# "inet:127.0.0.1:8891" (literal IP) - stanze submission/smtps maja
# chroot=y i NIE POTRAFIA rozwiazac nazwy "localhost" (brak
# /etc/hosts/resolvera w chroocie /var/spool/postfix), wiec milter sie
# nie laczy ("Cannot assign requested address") i milter_default_action
# = accept po cichu przepuszcza poczte BEZ PODPISU DKIM. Druga polowka
# tej naprawy (Socket w opendkim.conf) jest w dkim-install.sh - oba
# trzeba kliknac razem.
#
# Naprawia TEZ inet_interfaces = localhost (domyslny stan z pakietu RPM)
# -> "all" - bez tego Postfix NIGDY nie nasluchuje na porcie 25 na
# publicznym interfejsie (tylko 127.0.0.1/::1), wiec ZADNA poczta
# przychodzaca z internetu nie dociera, mimo poprawnego DNS/MX i
# otwartego firewalla. TA zmiana wymaga PELNEGO restartu (nie samego
# reload) - Postfix nie rebinduje listenera na nowy interfejs przy samym
# SIGHUP/reload, dlatego ponizej warunkowo uzywamy `systemctl restart`
# zamiast `reload`, TYLKO gdy inet_interfaces faktycznie sie zmienia.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

MAILBOX_LIMIT="${1:-}"
MESSAGE_LIMIT="${2:-}"

[[ "$MAILBOX_LIMIT" =~ ^[0-9]+$ ]] || err "nieprawidlowy mailbox_size_limit: '${MAILBOX_LIMIT}' (oczekiwano liczby calkowitej >= 0)."
[[ "$MESSAGE_LIMIT" =~ ^[0-9]+$ ]] || err "nieprawidlowy message_size_limit: '${MESSAGE_LIMIT}' (oczekiwano liczby calkowitej >= 0)."

OLD_MAILBOX="$(postconf -h mailbox_size_limit 2>/dev/null || true)"
OLD_MESSAGE="$(postconf -h message_size_limit 2>/dev/null || true)"
OLD_VIRTUAL_MAILBOX_LIMIT="$(postconf -h virtual_mailbox_limit 2>/dev/null || true)"
OLD_HOME_MAILBOX="$(postconf -h home_mailbox 2>/dev/null || true)"
OLD_SMTPD_MILTERS="$(postconf -h smtpd_milters 2>/dev/null || true)"
OLD_NON_SMTPD_MILTERS="$(postconf -h non_smtpd_milters 2>/dev/null || true)"
OLD_INET_INTERFACES="$(postconf -h inet_interfaces 2>/dev/null || true)"

rollback() {
  [ -n "$OLD_MAILBOX" ] && postconf -e "mailbox_size_limit=${OLD_MAILBOX}" >/dev/null 2>&1
  [ -n "$OLD_MESSAGE" ] && postconf -e "message_size_limit=${OLD_MESSAGE}" >/dev/null 2>&1
  [ -n "$OLD_VIRTUAL_MAILBOX_LIMIT" ] && postconf -e "virtual_mailbox_limit=${OLD_VIRTUAL_MAILBOX_LIMIT}" >/dev/null 2>&1
  [ -n "$OLD_HOME_MAILBOX" ] && postconf -e "home_mailbox=${OLD_HOME_MAILBOX}" >/dev/null 2>&1
  [ -n "$OLD_SMTPD_MILTERS" ] && postconf -e "smtpd_milters=${OLD_SMTPD_MILTERS}" >/dev/null 2>&1
  [ -n "$OLD_NON_SMTPD_MILTERS" ] && postconf -e "non_smtpd_milters=${OLD_NON_SMTPD_MILTERS}" >/dev/null 2>&1
  [ -n "$OLD_INET_INTERFACES" ] && postconf -e "inet_interfaces=${OLD_INET_INTERFACES}" >/dev/null 2>&1
  systemctl restart postfix >/dev/null 2>&1 || true
}

postconf -e "mailbox_size_limit=${MAILBOX_LIMIT}"
postconf -e "message_size_limit=${MESSAGE_LIMIT}"
postconf -e "virtual_mailbox_limit=${MAILBOX_LIMIT}"
if [ "$OLD_HOME_MAILBOX" != "Maildir/" ]; then
  postconf -e "home_mailbox=Maildir/"
fi
if [[ "$OLD_SMTPD_MILTERS" == *localhost* ]]; then
  postconf -e "smtpd_milters=inet:127.0.0.1:8891"
fi
if [[ "$OLD_NON_SMTPD_MILTERS" == *localhost* ]]; then
  postconf -e "non_smtpd_milters=inet:127.0.0.1:8891"
fi
NEED_RESTART=""
if [ "$OLD_INET_INTERFACES" != "all" ]; then
  postconf -e 'inet_interfaces = all'
  NEED_RESTART="1"
fi

if ! postfix check 2>/tmp/postfix-set-limits.err; then
  MSG="$(cat /tmp/postfix-set-limits.err 2>/dev/null)"
  rm -f /tmp/postfix-set-limits.err
  rollback
  err "Nowe limity nie przeszly 'postfix check': ${MSG} - przywrocono poprzednie wartosci."
fi
rm -f /tmp/postfix-set-limits.err

# inet_interfaces wymaga PELNEGO restartu (rebind listenera) - samo
# `reload` (SIGHUP) tego nie robi, patrz komentarz na gorze pliku.
if [ -n "$NEED_RESTART" ]; then
  RELOAD_CMD="restart"
else
  RELOAD_CMD="reload"
fi
if ! systemctl "$RELOAD_CMD" postfix 2>/tmp/postfix-set-limits.err; then
  MSG="$(cat /tmp/postfix-set-limits.err 2>/dev/null)"
  rm -f /tmp/postfix-set-limits.err
  rollback
  err "Przeladowanie postfix z nowymi limitami nie powiodlo sie: ${MSG} - przywrocono poprzednie wartosci."
fi
rm -f /tmp/postfix-set-limits.err

echo "OK: mailbox_size_limit=${MAILBOX_LIMIT}, message_size_limit=${MESSAGE_LIMIT}."
