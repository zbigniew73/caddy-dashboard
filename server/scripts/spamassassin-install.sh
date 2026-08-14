#!/usr/bin/env bash
#
# Instaluje SpamAssassin (spamd) + spamass-milter i podpina go do Postfixa
# jako KOLEJNY milter, OBOK juz istniejacego OpenDKIM (milter_default_action
# = accept juz ustawiony w mail-install.sh - awaria filtra NIE blokuje
# poczty, tak samo jak dla OpenDKIM). Punkt 9 z serii LinuxBabe.
#
# Pakiety EPEL (potwierdzone 2026-08-14 na zywym serwerze - AlmaLinux
# 10.2, spamassassin i spamass-milter oba dostepne tez pod EL9):
# - spamassassin: demon spamd, systemd unit "spamassassin.service"
#   (ExecStart=/usr/bin/spamd $SPAMDOPTIONS) - BEZ jawnego -A/--listen w
#   domyslnym /etc/sysconfig/spamassassin, wiec spamd uzywa wbudowanego
#   domyslnego adresu 127.0.0.1:783 (standardowy, ustalony od lat
#   domyslny port spamd).
# - spamass-milter: systemd unit "spamass-milter.service" (Wants/After
#   spamassassin.service - kolejnosc startu juz zalatwiona przez pakiet),
#   dziala jako NIEUPRZYWILEJOWANY user "sa-milt" (NIE uzywamy wariantu
#   "spamass-milter-root.service" - potrzebny tylko dla opcji -x, ktorej
#   nie uzywamy).
#
# WAZNE: domyslny socket spamass-milter to UNIX
# /run/spamass-milter/spamass-milter.sock - stanze submission/smtps w
# Postfiksie maja chroot=y, a proces w chroocie WIDZI TYLKO pliki
# wewnatrz /var/spool/postfix - socket spod /run byłby dla niego
# NIEWIDOCZNY. To ta sama rodzina bledow co dzisiejszy milter OpenDKIM
# (wtedy: rozwiazywanie nazwy "localhost" w chroocie; tu: widocznosc
# pliku socketu w chroocie) - rozwiazanie identyczne: przelaczamy na
# gniazdo TCP (127.0.0.1:8893, obok OpenDKIM na 8891) zamiast unix,
# PRZED pierwszym startem uslugi, zeby nigdy nie zadzialac na zlym
# domyslnym socketcie.
#
# Uzycie: spamassassin-install.sh
#   Domyslny prog twardego odrzucenia (-r): 12 - wyzszy niz standardowy
#   prog tagowania SpamAssassin (5.0, z /etc/mail/spamassassin/local.cf,
#   NIE ruszany) - tylko oczywisty spam jest odrzucany na poziomie SMTP,
#   nizej punktowane wiadomosci dostaja tylko naglowki X-Spam-* (do
#   przyszlego wykorzystania np. w regulach sieve).

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

dnf install -y spamassassin spamass-milter || err "Instalacja pakietow (spamassassin, spamass-milter) nie powiodla sie."

# DWIE ROZNE KONWENCJE TEGO SAMEGO ADRESU (potwierdzone na zywym
# serwerze 2026-08-14 - "Permission denied" przy binadowaniu, bo obie
# strony dostaly TEN SAM string w NIEWLASCIWYM dla siebie formacie):
# - milter (spamass-milter -p, WLASNY bind/nasluch) - konwencja libmilter
#   smfi_setconn(): "inet:PORT@HOST" (PORT pierwszy) - dokladnie tak jak
#   juz dzialajacy OpenDKIM ma "Socket inet:8891@127.0.0.1" w
#   opendkim.conf.
# - Postfix (smtpd_milters=, STRONA LACZACA SIE z milterem) - wlasna
#   konwencja Postfixa: "inet:HOST:PORT" (HOST pierwszy) - dokladnie tak
#   jak juz dzialajacy wpis "inet:127.0.0.1:8891" w smtpd_milters.
SPAMASS_MILTER_BIND="inet:8893@127.0.0.1"
SPAMASS_MILTER_POSTFIX_ADDR="inet:127.0.0.1:8893"
cat > /etc/sysconfig/spamass-milter <<EOF
# Zarzadzane przez Caddy Dashboard - server/scripts/spamassassin-install.sh
SOCKET="${SPAMASS_MILTER_BIND}"
SOCKET_OPTIONS=""
EXTRA_FLAGS="-r 12"
EOF
chmod 644 /etc/sysconfig/spamass-milter

# smtpd_milters/non_smtpd_milters - DOPISUJEMY spamass-milter PRZED juz
# istniejacym OpenDKIM (kolejnosc ma znaczenie: filtrowanie tresci
# powinno isc PRZED podpisywaniem DKIM, zeby ewentualne naglowki dodane
# przez spamass-milter byly juz obecne w momencie liczenia podpisu).
# Idempotentne - jesli nasz adres juz tam jest, nic nie zmieniamy.
for PARAM in smtpd_milters non_smtpd_milters; do
  CURRENT="$(postconf -h "$PARAM" 2>/dev/null || true)"
  if [[ "$CURRENT" != *"${SPAMASS_MILTER_POSTFIX_ADDR}"* ]]; then
    if [ -n "$CURRENT" ]; then
      postconf -e "${PARAM}=${SPAMASS_MILTER_POSTFIX_ADDR}, ${CURRENT}"
    else
      postconf -e "${PARAM}=${SPAMASS_MILTER_POSTFIX_ADDR}"
    fi
  fi
done

postfix check || err "Konfiguracja Postfixa nie przeszla walidacji (postfix check) po dopieciu spamass-milter."

systemctl enable --now spamassassin spamass-milter \
  || err "Pakiety zainstalowane, ale uruchomienie uslug spamassassin/spamass-milter nie powiodlo sie."
# Bezpieczne do ponownego uruchomienia na juz dzialajacych uslugach -
# enable --now na aktywnej usludze nie robi nic, wiec jawny reload
# ponizej gwarantuje ze ewentualne zmiany (np. socket) faktycznie sie
# zaladuja.
systemctl reload spamass-milter >/dev/null 2>&1 || systemctl restart spamass-milter >/dev/null 2>&1 || true
systemctl reload postfix >/dev/null 2>&1 || true

echo "OK: SpamAssassin + spamass-milter zainstalowane i podpiete do Postfixa (prog odrzucenia: 12, tagowanie od 5.0 - edytowalne w panelu)."
