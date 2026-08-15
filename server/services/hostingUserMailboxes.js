import {
  listVirtualDomains,
  listVirtualMailboxes, addVirtualMailbox, setVirtualMailboxPassword, removeVirtualMailbox,
  listVirtualAliases, addVirtualAlias, removeVirtualAlias
} from './mailVirtual.js';

// Self-service warstwa dla panelu /user/ nad mailVirtual.js (do tej pory
// wywolywanym WYLACZNIE z panelu admina) - Poczta -> "Dodaj konto e-mail"/
// "Dodaj przekierowanie/alias", zadanie usera 2026-08-15. Jedyna nowa
// odpowiedzialnosc tutaj to GRANICA WLASNOSCI: kazda operacja musi
// najpierw potwierdzic, ze podana domena NALEZY do wywolujacego konta
// hostingowego (ownerAccount z tabeli domains) - inaczej jeden hosting
// user moglby zakladac/usuwac skrzynki na CUDZEJ domenie mailowej, tylko
// znajac jej nazwe. mailVirtual.js samo w sobie nie zna pojecia "kto
// pyta" (admin-only do tej pory), wiec ta warstwa jest tu, nie tam.

async function assertOwnDomain(username, domain) {
  const domains = await listVirtualDomains();
  const found = domains.find((d) => d.domain === domain);
  if (!found || found.ownerAccount !== username) {
    throw Object.assign(new Error('Nie znaleziono domeny pocztowej lub nie nalezy do Twojego konta.'), { status: 404 });
  }
}

// Domeny, na ktorych ten hosting user moze zakladac skrzynki/aliasy - TYLKO
// baza strony (np. "nowa.domena.pl"), NIGDY "mail.<domena>". User wyjasnil
// 2026-08-15: "mail.<domena>" istnieje wylacznie jako hostname serwera
// Postfixa/Dovecota (na niej stoi rekord MX + certyfikat SNI, patrz
// buildMailStubBlock w hostingUserSites.js i [[project_caddy_dashboard_mail_sni]])
// - nikt nie powinien zakladac tam realnych skrzynek. Obie domeny SA
// rownouprawnione po stronie mailVirtual.js/Postfixa (obie trafiaja do tej
// samej tabeli domains), wiec filtrowanie jest CELOWO tylko kosmetyczne/
// UX-owe tutaj, nie zmienia niczego w backendzie - proste odciecie po
// prefiksie "mail." (edge case: gdyby czyjas prawdziwa domena strony
// FAKTYCZNIE zaczynala sie od "mail." wlasnie jako jej wlasna nazwa,
// zostalaby tez ukryta - swiadomie zaakceptowane ryzyko, brzegowy
// przypadek).
async function listOwnMailDomains(username) {
  const domains = await listVirtualDomains();
  return domains
    .filter((d) => d.ownerAccount === username && !d.domain.startsWith('mail.'))
    .map((d) => d.domain);
}

async function listOwnMailboxes(username, domain) {
  await assertOwnDomain(username, domain);
  return listVirtualMailboxes(domain);
}

async function createOwnMailbox(username, domain, localpart, password) {
  await assertOwnDomain(username, domain);
  return addVirtualMailbox(domain, localpart, password);
}

async function setOwnMailboxPassword(username, domain, localpart, password) {
  await assertOwnDomain(username, domain);
  return setVirtualMailboxPassword(domain, localpart, password);
}

async function removeOwnMailbox(username, domain, localpart) {
  await assertOwnDomain(username, domain);
  return removeVirtualMailbox(domain, localpart);
}

async function listOwnAliases(username, domain) {
  await assertOwnDomain(username, domain);
  return listVirtualAliases(domain);
}

async function createOwnAlias(username, domain, sourceLocalpart, destination) {
  await assertOwnDomain(username, domain);
  return addVirtualAlias(domain, sourceLocalpart, destination);
}

async function removeOwnAlias(username, domain, sourceLocalpart, destination) {
  await assertOwnDomain(username, domain);
  return removeVirtualAlias(domain, sourceLocalpart, destination);
}

export {
  listOwnMailDomains,
  listOwnMailboxes, createOwnMailbox, setOwnMailboxPassword, removeOwnMailbox,
  listOwnAliases, createOwnAlias, removeOwnAlias
};
