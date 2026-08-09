#!/usr/bin/env bash
#
# Wspolna funkcja generowania hasel dla skryptow instalacyjnych pakietow
# z sekcji "Install" (MariaDB/PostgreSQL/MongoDB/Redis - root/admin haslo).
# Ta sama regula co dla cdadmin w install.sh (tam zduplikowana zamiast
# zrodlowana, bo install.sh dziala przez `curl | sudo bash` zanim repo jest
# sklonowane) - zmieniaj oba miejsca razem.
#
# 16 znakow = 5 wielkich liter + 5 malych liter + 3 cyfry + 3 znaki specjalne
# z bezpiecznego zestawu (bez cudzyslowow/apostrofow/backslasha - hasla
# trafiaja tez do zapytan SQL i JS w mongosh), calosc tasowana losowo.

gen_password() {
  local upper lower digit special pass
  upper="$(LC_ALL=C tr -dc 'A-Z' < /dev/urandom | head -c5)"
  lower="$(LC_ALL=C tr -dc 'a-z' < /dev/urandom | head -c5)"
  digit="$(LC_ALL=C tr -dc '0-9' < /dev/urandom | head -c3)"
  special="$(LC_ALL=C tr -dc '!@#%*()_+=-' < /dev/urandom | head -c3)"
  pass="$(printf '%s%s%s%s' "$upper" "$lower" "$digit" "$special" | fold -w1 | shuf | tr -d '\n')"
  printf '%s' "$pass"
}
