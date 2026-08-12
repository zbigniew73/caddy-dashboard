import { Router } from 'express';
import { getMustChangePassword, changeOwnPassword, getOwnAccount } from '../services/hostingUserSelf.js';
import { listCronJobs, createCronJob, updateCronJob, deleteCronJob, listPhpCliPaths } from '../services/hostingUserCron.js';
import { listOwnDatabases, createDatabase, deleteDatabase } from '../services/hostingUserDatabases.js';
import {
  listOwnSites, createSite, updateSiteRedirect, toggleSite, deleteSite,
  getSiteConfig, checkSiteConfig, updateSiteConfig
} from '../services/hostingUserSites.js';
import { getOwnRedisStatus, startOwnRedis, stopOwnRedis, testOwnRedis } from '../services/hostingUserRedis.js';
import { getConnectionInfo, listSshKeys, addSshKey, deleteSshKey } from '../services/hostingUserSsh.js';

const router = Router();

// req.hostingUser jest ustawiane przez requireUserAuth (server/services/auth.js)
// z podpisanego ciasteczka - NIGDY z ciala zadania, zeby jeden user nie
// mogl operowac na koncie innego.
router.get('/me', async (req, res) => {
  try {
    const [account, mustChangePassword] = await Promise.all([
      getOwnAccount(req.hostingUser),
      getMustChangePassword(req.hostingUser)
    ]);
    res.json({ ...account, mustChangePassword });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await changeOwnPassword(req.hostingUser, currentPassword, newPassword);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/cron', async (req, res) => {
  try {
    res.json(await listCronJobs(req.hostingUser));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/cron/php-paths', (req, res) => {
  res.json(listPhpCliPaths());
});

router.post('/cron', async (req, res) => {
  try {
    const { name, schedule, command } = req.body || {};
    res.json(await createCronJob(req.hostingUser, { name, schedule, command }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/cron/:id', async (req, res) => {
  try {
    const { name, schedule, command, enabled } = req.body || {};
    res.json(await updateCronJob(req.hostingUser, req.params.id, { name, schedule, command, enabled }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/cron/:id', async (req, res) => {
  try {
    await deleteCronJob(req.hostingUser, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/sites', async (req, res) => {
  try {
    res.json(await listOwnSites(req.hostingUser));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/sites', async (req, res) => {
  try {
    const { domain, redirectMode, template, phpVersion } = req.body || {};
    res.json(await createSite(req.hostingUser, { domain, redirectMode, template, phpVersion }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/sites/:id', async (req, res) => {
  try {
    const { redirectMode } = req.body || {};
    res.json(await updateSiteRedirect(req.hostingUser, req.params.id, redirectMode));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/sites/:id/config', async (req, res) => {
  try {
    res.json(await getSiteConfig(req.hostingUser, req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/sites/:id/config/check', async (req, res) => {
  try {
    const { content } = req.body || {};
    res.json(await checkSiteConfig(req.hostingUser, req.params.id, content));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/sites/:id/config', async (req, res) => {
  try {
    const { content } = req.body || {};
    res.json(await updateSiteConfig(req.hostingUser, req.params.id, content));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/sites/:id/start', async (req, res) => {
  try {
    res.json(await toggleSite(req.hostingUser, req.params.id, true));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/sites/:id/stop', async (req, res) => {
  try {
    res.json(await toggleSite(req.hostingUser, req.params.id, false));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/sites/:id', async (req, res) => {
  try {
    await deleteSite(req.hostingUser, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/databases', async (req, res) => {
  try {
    res.json(await listOwnDatabases(req.hostingUser));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/databases', async (req, res) => {
  try {
    const { engine, nameSuffix } = req.body || {};
    res.json(await createDatabase(req.hostingUser, { engine, nameSuffix }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/databases/:id', async (req, res) => {
  try {
    await deleteDatabase(req.hostingUser, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/redis', async (req, res) => {
  try {
    res.json(await getOwnRedisStatus(req.hostingUser));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/redis/start', async (req, res) => {
  try {
    const { enablePassword, password } = req.body || {};
    res.json(await startOwnRedis(req.hostingUser, { enablePassword: !!enablePassword, password }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/redis/stop', async (req, res) => {
  try {
    res.json(await stopOwnRedis(req.hostingUser));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/redis/test', async (req, res) => {
  try {
    res.json(await testOwnRedis(req.hostingUser));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/ssh', async (req, res) => {
  try {
    const [connection, keys] = await Promise.all([
      getConnectionInfo(req.hostingUser),
      listSshKeys(req.hostingUser)
    ]);
    res.json({ connection, keys });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/ssh/keys', async (req, res) => {
  try {
    const { name, publicKey } = req.body || {};
    res.json({ keys: await addSshKey(req.hostingUser, { name, publicKey }) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/ssh/keys/delete', async (req, res) => {
  try {
    const { keyData } = req.body || {};
    res.json({ keys: await deleteSshKey(req.hostingUser, keyData) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
