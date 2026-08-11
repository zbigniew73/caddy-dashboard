import { Router } from 'express';
import { getMustChangePassword, changeOwnPassword, getOwnAccount } from '../services/hostingUserSelf.js';

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

export default router;
