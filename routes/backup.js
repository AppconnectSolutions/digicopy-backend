import express from "express";
import { getBackupStatus, setBackupEnabled, runBackupNow } from "../services/backupScheduler.js";

const router = express.Router();

// GET /api/backup/status
router.get("/status", async (req, res) => {
  try {
    const data = await getBackupStatus();
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// PUT /api/backup/status  body: { enabled: true/false }
router.put("/status", async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    const out = await setBackupEnabled(enabled);
    res.json(out);
  } catch (e) {
    console.error("PUT /api/backup/status failed:", e); // ✅ IMPORTANT
    res.status(500).json({
      ok: false,
      message: e.message,
      stack: process.env.NODE_ENV !== "production" ? e.stack : undefined,
    });
  }
});


// POST /api/backup/run (manual trigger)
router.post("/run", async (req, res) => {
  try {
    await runBackupNow();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

export default router;
