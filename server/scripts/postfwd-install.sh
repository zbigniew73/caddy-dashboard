#!/usr/bin/env bash
#
# Instaluje postfwd (Postfix policy daemon) i podpina go do Postfixa jako
# limiter tempa wysylki PER-KONTO (kluczowany po sasl_username - kazde
# uwierzytelnione konto ma WLASNY, niezalezny licznik). Chroni przed
# nadzuzyciem WYCHODZACYM (np. przejete konto hostingowe wysylajace masowo
# spam przez nasz serwer) - odwrotna sprawa niz DNSBL/greylisting (te
# chronia przed spamem PRZYCHODZACYM z zewnatrz).
#
# Pakiet EPEL "postfwd" (potwierdzone 2026-08-14 na zywym serwerze -
# AlmaLinux 10.2, dostepny tez pod EL9 jako postfwd-2.03-5.el9):
# - binarka /usr/sbin/postfwd (alias postfwd3)
# - usluga systemd postfwd.service, GOTOWA (wlasny user/group "postfwd"
#   utworzony przez sysusers.d, PIDFile/katalog /run przez tmpfiles.d)
# - domyslny socket z jednostki: tcp:localhost:10040 - "localhost" (NIE
#   literal IP) jest DOKLADNIE tym samym bledem co dzis rano przy
#   milterze OpenDKIM (chrootowane stanze submission/smtps NIE POTRAFIA
#   rozwiazac nazwy hosta) - nadpisujemy na 127.0.0.1 w
#   /etc/sysconfig/postfwd PONIZEJ, zanim cokolwiek sie uruchomi.
# - config regul: /etc/postfwd/postfwd.cf (proste, plaskie reguly, NIE
#   format --loadsettings/Perl-hash z postfwd.settings.sample - tamten
#   plik nie jest w ogole uzywany przez nasza jednostke systemd)
#
# Skladnia regul potwierdzona z RZECZYWISTEGO
# /usr/share/doc/postfwd/postfwd.cf.sample dolaczonego do TEGO pakietu
# (nie z ogolnej dokumentacji na GitHubie, ktora bywa z innej wersji):
# "id=NAZWA" + warunki linia po linii + "action=...", wartosci
# referencjonowane w akcji maja prefiks "$$" (np. $$sasl_username).
#
# Uzycie: postfwd-install.sh
#   Domyslne limity (edytowalne pozniej przyciskiem "Zapisz" w panelu,
#   patrz postfwd-set-limits.sh): 20/minute, 180/hour, 900/day.

set -uo pipefail

err() { echo "BLAD: $*" >&2; exit 1; }

dnf install -y postfwd || err "Instalacja pakietu postfwd nie powiodla sie."

# Literal IP, NIE "localhost" - patrz komentarz na gorze. Port 10040 zgodny
# z domyslnym z jednostki systemd (nie zmieniamy, tylko adres).
cat > /etc/sysconfig/postfwd <<'EOF'
# Zarzadzane przez Caddy Dashboard - server/scripts/postfwd-install.sh
SERVER_SOCKET="tcp:127.0.0.1:10040"
EOF
chmod 644 /etc/sysconfig/postfwd

POSTFWD_CF="/etc/postfwd/postfwd.cf"
mkdir -p /etc/postfwd
# Pakiet SAM dostarcza /etc/postfwd (root:postfwd, 750 - grupowe, NIE
# world-readable) I domyslny /etc/postfwd/postfwd.cf (maly plik-zaslepka,
# data budowy pakietu, np. 2020) - potwierdzone na zywym serwerze
# 2026-08-14. Dwa nastepstwa:
# 1) katalog trzeba jawnie otworzyc (755), inaczej panel (inny user niz
#    "postfwd") nie moze nawet do niego wejsc, zeby przeczytac status -
#    ten sam bledny wzorzec (poleganie na domyslnych uprawnieniach) co
#    OpenDKIM wczesniej tego samego dnia.
# 2) NIGDY nie warunkuj zapisu "tylko jesli plik nie istnieje" - pakiet
#    JUZ go dostarczyl, wiec taki warunek nigdy by sie nie spelnil i
#    nasze reguly (20/180/900) nigdy by tam nie trafily. Plik jest w
#    calosci NASZ (zarzadzany rowniez przez postfwd-set-limits.sh) -
#    nadpisujemy bezwarunkowo, zawsze.
chmod 755 /etc/postfwd
cat > "$POSTFWD_CF" <<'EOF'
# Zarzadzane przez Caddy Dashboard - server/scripts/postfwd-set-limits.sh
# Limit tempa wysylki PER uwierzytelnione konto (sasl_username) - trzy
# niezalezne okna naraz (minuta/godzina/dzien), kazde musi byc realnie
# wiazace (dzienne < godzinowe*24, godzinowe < minutowe*60), inaczej
# szersze okno nic nie wnosi ponad wezsze.
id=RATE_MIN
        sasl_username=!!^$
        action=rate($$sasl_username/20/60/450 4.7.1 rate limit exceeded, try again in a minute)

id=RATE_HOUR
        sasl_username=!!^$
        action=rate($$sasl_username/180/3600/450 4.7.1 rate limit exceeded, try again later)

id=RATE_DAY
        sasl_username=!!^$
        action=rate($$sasl_username/900/86400/450 4.7.1 daily sending limit exceeded)

id=DEFAULT
        action=dunno
EOF
chmod 644 "$POSTFWD_CF"

# smtpd_recipient_restrictions jest WSPOLDZIELONE z postfix-antispam.sh
# (DNSBL Spamhaus) - SKLADAMY cala wartosc na nowo za kazdym razem, zamiast
# chirurgicznie doklejac/usuwac fragment tekstu (unika rozjazdu kolejnosci
# przy wlaczaniu/wylaczaniu funkcji w dowolnej kolejnosci). Ta sama funkcja
# musi zostac recznie zsynchronizowana w OBU skryptach - patrz komentarz w
# postfix-antispam.sh. Obecnosc smtpd_helo_restrictions to sygnal "antyspam
# juz wlaczony" (ten parametr jest ustawiany WYLACZNIE przez tamten skrypt).
rebuild_recipient_restrictions() {
  local parts="permit_mynetworks, permit_sasl_authenticated, check_policy_service inet:127.0.0.1:10040"
  if postconf -h smtpd_helo_restrictions 2>/dev/null | grep -q .; then
    parts="${parts}, reject_rbl_client zen.spamhaus.org, reject_rhsbl_helo dbl.spamhaus.org, reject_rhsbl_reverse_client dbl.spamhaus.org, reject_rhsbl_sender dbl.spamhaus.org"
  fi
  parts="${parts}, reject_unauth_destination"
  postconf -e "smtpd_recipient_restrictions = ${parts}"
}
rebuild_recipient_restrictions

postfix check || err "Konfiguracja Postfixa nie przeszla walidacji (postfix check) po dopieciu postfwd."

systemctl enable --now postfwd \
  || err "Pakiet zainstalowany, ale uruchomienie uslugi postfwd nie powiodlo sie."
# Bezpieczne do ponownego uruchomienia na juz dzialajacym postfwd/postfix -
# enable --now na aktywnej usludze nie robi nic (start na running unit to
# no-op), wiec jawny reload ponizej gwarantuje ze ewentualne zmiany (np.
# nowy adres socketu) faktycznie sie zaladuja.
systemctl reload postfwd >/dev/null 2>&1 || true
systemctl reload postfix >/dev/null 2>&1 || true

echo "OK: postfwd zainstalowany i podpiety do Postfixa (limit wysylki: 20/min, 180/godz, 900/dzien - edytowalne w panelu)."
