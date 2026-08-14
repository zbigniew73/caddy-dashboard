#!/usr/bin/env bash
#
# Wlacza/wylacza natywna ochrone antyspamowa Postfixa (punkty 1-4 i 6 z
# serii samouczkow LinuxBabe "Blocking Email Spam with Postfix") - CZYSTA
# konfiguracja main.cf, ZERO nowych uslug/demonow:
#  1. reject_unknown_reverse_client_hostname - odrzuca nadawcow bez PTR
#  2. smtpd_helo_required + reject_invalid/non_fqdn/unknown_helo_hostname
#  3. reject_unknown_client_hostname - odrzuca hosty bez wlasnego rekordu A
#  4. reject_unknown_sender_domain - odrzuca nadawcow z domena bez MX/A
#  6. Spamhaus DNSBL (zen.spamhaus.org + dbl.spamhaus.org) w
#     smtpd_recipient_restrictions
#
# permit_mynetworks + permit_sasl_authenticated ZAWSZE PIERWSZE w
# smtpd_sender_restrictions - wlasne, uwierzytelnione konta hostingowe
# (submission/smtps) NIGDY nie sa poddawane tym sprawdzeniom (np. klient
# laczacy sie z domowego lacza bez PTR nadal moglby normalnie wysylac).
#
# smtpd_recipient_restrictions jest WSPOLDZIELONE z postfwd
# (server/scripts/postfwd-install.sh, limiter tempa wysylki) - obie
# funkcje SKLADAJA cala wartosc na nowo za kazdym razem
# (rebuild_recipient_restrictions), zamiast probowac chirurgicznie
# doklejac/usuwac fragment tekstu - unika rozjazdu kolejnosci przy
# wlaczaniu/wylaczaniu w dowolnej kolejnosci. Ta sama funkcja (recznie
# zsynchronizowana miedzy obydwoma skryptami - jeden string, dwa miejsca,
# jak wszedzie w tym projekcie) musi zostac zmieniona w OBU plikach,
# jesli kiedys dojdzie trzecia funkcja dopisujaca sie do tej listy.
#
# Uzycie: postfix-antispam.sh enable|disable

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

ACTION="${1:-}"
[ "$ACTION" = "enable" ] || [ "$ACTION" = "disable" ] || err "nieznana akcja '${ACTION}' (oczekiwano enable|disable)."

rebuild_recipient_restrictions() {
  local rbl_enabled="$1"
  local parts="permit_mynetworks, permit_sasl_authenticated"
  if systemctl is-active --quiet postfwd 2>/dev/null; then
    parts="${parts}, check_policy_service inet:127.0.0.1:10040"
  fi
  if [ "$rbl_enabled" = "yes" ]; then
    parts="${parts}, reject_rbl_client zen.spamhaus.org, reject_rhsbl_helo dbl.spamhaus.org, reject_rhsbl_reverse_client dbl.spamhaus.org, reject_rhsbl_sender dbl.spamhaus.org"
  fi
  parts="${parts}, reject_unauth_destination"
  postconf -e "smtpd_recipient_restrictions = ${parts}"
}

OLD_HELO_REQUIRED="$(postconf -h smtpd_helo_required 2>/dev/null || true)"
OLD_HELO_RESTRICTIONS="$(postconf -h smtpd_helo_restrictions 2>/dev/null || true)"
OLD_SENDER_RESTRICTIONS="$(postconf -h smtpd_sender_restrictions 2>/dev/null || true)"
OLD_RECIPIENT_RESTRICTIONS="$(postconf -h smtpd_recipient_restrictions 2>/dev/null || true)"

rollback() {
  [ -n "$OLD_HELO_REQUIRED" ] && postconf -e "smtpd_helo_required=${OLD_HELO_REQUIRED}" >/dev/null 2>&1
  postconf -e "smtpd_helo_restrictions=${OLD_HELO_RESTRICTIONS}" >/dev/null 2>&1
  postconf -e "smtpd_sender_restrictions=${OLD_SENDER_RESTRICTIONS}" >/dev/null 2>&1
  postconf -e "smtpd_recipient_restrictions=${OLD_RECIPIENT_RESTRICTIONS}" >/dev/null 2>&1
  systemctl reload postfix >/dev/null 2>&1 || true
}

if [ "$ACTION" = "enable" ]; then
  postconf -e 'smtpd_helo_required = yes'
  postconf -e 'smtpd_helo_restrictions = reject_invalid_helo_hostname, reject_non_fqdn_helo_hostname, reject_unknown_helo_hostname'
  postconf -e 'smtpd_sender_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unknown_sender_domain, reject_unknown_reverse_client_hostname, reject_unknown_client_hostname'
  rebuild_recipient_restrictions "yes"
else
  # -X USUWA parametr z main.cf (powrot do wbudowanej wartosci domyslnej
  # Postfixa), NIE ustawia pustej wartosci - to jest realne "wylaczenie",
  # nie tylko pusty string.
  postconf -X smtpd_helo_required >/dev/null 2>&1 || true
  postconf -X smtpd_helo_restrictions >/dev/null 2>&1 || true
  postconf -X smtpd_sender_restrictions >/dev/null 2>&1 || true
  rebuild_recipient_restrictions "no"
fi

if ! postfix check 2>/tmp/postfix-antispam.err; then
  MSG="$(cat /tmp/postfix-antispam.err 2>/dev/null)"
  rm -f /tmp/postfix-antispam.err
  rollback
  err "Nowa konfiguracja nie przeszla walidacji (postfix check): ${MSG} - przywrocono poprzednie wartosci."
fi
rm -f /tmp/postfix-antispam.err

if ! systemctl reload postfix 2>/tmp/postfix-antispam.err; then
  MSG="$(cat /tmp/postfix-antispam.err 2>/dev/null)"
  rm -f /tmp/postfix-antispam.err
  rollback
  err "Przeladowanie postfix nie powiodlo sie: ${MSG} - przywrocono poprzednie wartosci."
fi
rm -f /tmp/postfix-antispam.err

if [ "$ACTION" = "enable" ]; then
  echo "OK: ochrona antyspamowa Postfixa (PTR/HELO/DNSBL) wlaczona."
else
  echo "OK: ochrona antyspamowa Postfixa (PTR/HELO/DNSBL) wylaczona."
fi
