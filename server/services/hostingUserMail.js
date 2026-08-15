import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readDisabledUsernames, getPostfixLimits } from './mail.js';
import { getServiceDef, getServiceStatus } from './systemServices.js';
import { detectBaseDomain } from './roundcubeSite.js';

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url)) + '/../scripts';

function sudoErrorMessage(scriptName, stderr) {
  if (/password is required/i.test(stderr)) {
    return `Brak uprawnien sudo bez hasla dla ${scriptName} - sprawdz /etc/sudoers.d/caddy-dashboard`;
  }
  return stderr.trim() || null;
}

// Rozmiar (MB) + liczba wiadomosci wlasnego ~/Maildir, patrz
// hosting-user-mailbox-stats.sh - katalog domowy nalezy do konta
// hostingowego (pelny SSH), wiec nie jest czytelny dla serwisowego usera
// panelu bez sudo, ten sam wzorzec co getDiskUsageMb w hostingUserSelf.js.
function getMailboxStats(username) {
  return new Promise((resolve, reject) => {
    const child = spawn('sudo', ['-n', `${SCRIPTS_DIR}/hosting-user-mailbox-stats.sh`, username]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => reject(Object.assign(new Error(e.message), { status: 500 })));
    child.on('close', (code) => {
      if (code === 0) {
        const [sizeMb, messageCount] = stdout.trim().split('\n').map((n) => parseInt(n, 10) || 0);
        resolve({ sizeMb: sizeMb || 0, messageCount: messageCount || 0 });
        return;
      }
      reject(Object.assign(
        new Error(sudoErrorMessage('hosting-user-mailbox-stats.sh', stderr) || `exit code ${code}`), { status: 500 }
      ));
    });
  });
}

// "mailInstalled" idzie przez ten sam systemServices.js co Glowne->Poczta
// admina (postfix.service jako reprezentant, patrz SERVICE_REGISTRY) -
// zeby panel usera nie pokazywal wlasnego adresu/statystyk na koncie,
// gdzie Poczta nigdy nie zostala zainstalowana przez admina.
async function getOwnMail(username) {
  const postfixStatus = await getServiceStatus(getServiceDef('postfix'));
  if (!postfixStatus.found) {
    return {
      mailInstalled: false,
      accessEnabled: false,
      emailAddress: null,
      sizeMb: 0,
      messageCount: 0,
      mailboxLimitMb: null
    };
  }

  const [{ suggested: baseDomain }, limits, stats] = await Promise.all([
    detectBaseDomain(),
    getPostfixLimits(),
    getMailboxStats(username).catch(() => ({ sizeMb: 0, messageCount: 0 }))
  ]);
  const disabled = readDisabledUsernames();

  return {
    mailInstalled: true,
    accessEnabled: !disabled.has(username),
    emailAddress: baseDomain ? `${username}@${baseDomain}` : null,
    sizeMb: stats.sizeMb,
    messageCount: stats.messageCount,
    mailboxLimitMb: Number.isFinite(limits.mailboxSizeBytes) ? Math.round(limits.mailboxSizeBytes / (1024 * 1024)) : null
  };
}

export { getOwnMail };
