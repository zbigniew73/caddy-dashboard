import { Router } from 'express';
import os from 'os';

const router = Router();

router.get('/system', (req, res) => {
  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    uptimeSeconds: Math.floor(os.uptime())
  });
});

export default router;
