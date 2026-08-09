import fs from 'fs';

// Node ma userInfo() dla biezacego procesu, ale nie ma wbudowanego
// odwzorowania nazwa-grupy -> GID dla DOWOLNEJ grupy - czytamy /etc/group
// bezposrednio (ten proces i tak dziala jako root, wiec ma do niego dostep).
function resolveGid(groupName) {
  const content = fs.readFileSync('/etc/group', 'utf-8');
  for (const line of content.split('\n')) {
    const parts = line.split(':');
    if (parts[0] === groupName) return parseInt(parts[2], 10);
  }
  return null;
}

// Socket tworzy sie jako root:root 0755 domyslnie - zawezamy go do
// root:<grupa cdadmin>, 660, zeby jedynie panel (proces dzialajacy jako
// cdadmin) mogl sie z nim laczyc. Jesli grupa jeszcze nie istnieje (np.
// pierwsze uruchomienie przed pelnym install.sh), zostawiamy 600 -
// root-only - zamiast padac, ale ostrzegamy w logu, bo wtedy panel nie
// bedzie mial dostepu dopoki daemon nie zostanie zrestartowany.
function secureSocket(socketPath, groupName) {
  const gid = groupName ? resolveGid(groupName) : null;
  if (gid === null) {
    console.warn(`[OSTRZEZENIE] Nie znaleziono grupy "${groupName}" - socket zostaje root-only (600). Zrestartuj ta usluge po utworzeniu grupy.`);
    fs.chmodSync(socketPath, 0o600);
    return;
  }
  try {
    fs.chownSync(socketPath, 0, gid);
  } catch (e) {
    throw new Error(
      `Nie udalo sie ustawic wlasciciela socketu na root:${groupName} (${e.message}). ` +
      'Runtime Manager musi dzialac jako root (User=root w caddy-dashboard-runtime.service) - sprawdz konfiguracje uslugi.'
    );
  }
  fs.chmodSync(socketPath, 0o660);
}

export { secureSocket };
