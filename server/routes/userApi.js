import { Router } from 'express';
import { getMustChangePassword, changeOwnPassword, getOwnAccount } from '../services/hostingUserSelf.js';
import { listCronJobs, createCronJob, updateCronJob, deleteCronJob, listPhpCliPaths } from '../services/hostingUserCron.js';

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

export default router;
