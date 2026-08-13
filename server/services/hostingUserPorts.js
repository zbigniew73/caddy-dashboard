import net from 'net';
import { listUsedProxyPorts } from './hostingUserSites.js';
import { listUsedPythonAppPorts } from './hostingUserPython.js';
import { listUsedNodeAppPorts } from './hostingUserNode.js';

// Wspolne sprawdzenie "wolnego portu" dla WSZYSTKICH runtime'ow
// aplikacji usera (Python, Node, ...) - wydzielone z hostingUserPython.js,
// zeby Python i Node MOGLY SIE NAWZAJEM WIDZIEC (dwie niezalezne
// aplikacje na roznych runtime'ach moga kolidowac o ten sam port
// dokladnie tak samo jak dwie aplikacje w tym samym jezyku). Trzymanie
// tego w jednym z dwoch serwisow zmuszaloby drugi do importu z niego -
// cykl importow - stad osobny, neutralny modul.
//
// CZTERY niezalezne sygnaly, wszystkie musza wyjsc czysto:
//   1) rejestr stron: port juz PRZYPISANY do strony reverseproxy
//      JAKIEGOKOLWIEK konta (listUsedProxyPorts() w hostingUserSites.js).
//   2) rejestr aplikacji Python (listUsedPythonAppPorts()).
//   3) rejestr aplikacji Node (listUsedNodeAppPorts()).
//   4) zywy test bindowania - lapie WSZYSTKO co faktycznie nasluchuje
//      TERAZ (Caddy, baza danych, cokolwiek spoza powyzszych rejestrow) -
//      to jedyny sygnal, ktory NAPRAWDE gwarantuje wolny port.
// PORT_RANGE to tylko PUNKT STARTOWY przeszukiwania - nie jest zrodlem
// prawdy o tym, co jest "bezpieczne" (to robia powyzsze sygnaly), tylko
// wygodny, udokumentowany zakres do zaczecia (ponizej typowych portow
// uslug, ponizej typowego zakresu efemerycznych portow wychodzacych
// Linuksa).
const PORT_RANGE = [20000, 29999];

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function panelOwnPort() {
  const fromEnv = parseInt(process.env.PORT, 10);
  return Number.isInteger(fromEnv) ? fromEnv : 4300;
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function isPortFree(port, exclude = []) {
  if (port === panelOwnPort()) return false;
  if (exclude.includes(port)) return false;
  if (listUsedProxyPorts().includes(port)) return false;
  if (listUsedPythonAppPorts().includes(port)) return false;
  if (listUsedNodeAppPorts().includes(port)) return false;
  return isPortListening(port);
}

// `exclude` - porty do TEZ traktowania jako zajete w tym jednym
// wywolaniu, bez zapisywania ich nigdzie na stale - potrzebne, gdy
// jedna aplikacja wymaga WIECEJ NIZ JEDNEGO portu na raz (np. Laravel
// Octane: port publiczny + --admin-port) - drugie wywolanie musi
// wykluczyc port dopiero co zwrocony przez pierwsze, bo nic tam jeszcze
// nie nasluchuje (zywy bind-test sam by tego nie zlapal), a zaden
// rejestr JSON tez jeszcze o nim nie wie (jeszcze nie zapisany).
async function findFreePort(preferredPort, exclude = []) {
  if (preferredPort !== undefined && preferredPort !== null && preferredPort !== '') {
    const port = parseInt(preferredPort, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw badRequest('Nieprawidlowy numer portu (1-65535).');
    }
    return { port, free: await isPortFree(port, exclude) };
  }

  const [start, end] = PORT_RANGE;
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port, exclude)) return { port, free: true };
  }
  throw Object.assign(new Error('Nie znaleziono wolnego portu w zakresie ' + start + '-' + end + '.'), { status: 500 });
}

export { findFreePort, isPortFree };
