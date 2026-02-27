import express from "express";
import { query } from "./dbHelper.js";

const router = express.Router();

/**
 * Get active promotion (single)
 */
router.get("/active", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT id, title, message, active, updated_at
       FROM promotions
       WHERE active = 1
       ORDER BY updated_at DESC
       LIMIT 1`
    );

    res.json(rows?.[0] || { id: null, title: "", message: "", active: 0 });
  } catch (err) {
    console.error("Get active promotion error:", err);
    res.status(500).json({ message: "Failed to fetch active promotion" });
  }
});

/**
 * List all promotions
 */
router.get("/", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT id, title, message, active, created_at, updated_at
       FROM promotions
       ORDER BY updated_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("List promotions error:", err);
    res.status(500).json({ message: "Failed to fetch promotions" });
  }
});

/**
 * Create promotion
 * body: { title?, message, active? }
 */
router.post("/", async (req, res) => {
  try {
    const { title = "", message, active = 0 } = req.body || {};
    if (!message || !String(message).trim()) {
      return res.status(400).json({ message: "Promotion message is required" });
    }

    // If setting active, deactivate all first
    if (Number(active) === 1) {
      await query(`UPDATE promotions SET active = 0`);
    }

    const [result] = await query(
      `INSERT INTO promotions (title, message, active)
       VALUES (?, ?, ?)`,
      [title, message, Number(active) === 1 ? 1 : 0]
    );

    res.status(201).json({ message: "Promotion created", id: result.insertId });
  } catch (err) {
    console.error("Create promotion error:", err);
    res.status(500).json({ message: "Failed to create promotion" });
  }
});

/**
 * Update promotion
 * body: { title?, message?, active? }
 */
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, message, active } = req.body || {};

    // If active=1 => deactivate all first
    if (active !== undefined && Number(active) === 1) {
      await query(`UPDATE promotions SET active = 0`);
    }

    // Build dynamic update
    const fields = [];
    const params = [];

    if (title !== undefined) {
      fields.push("title = ?");
      params.push(title);
    }
    if (message !== undefined) {
      if (!String(message).trim()) {
        return res.status(400).json({ message: "Message cannot be empty" });
      }
      fields.push("message = ?");
      params.push(message);
    }
    if (active !== undefined) {
      fields.push("active = ?");
      params.push(Number(active) === 1 ? 1 : 0);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    params.push(id);

    await query(
      `UPDATE promotions
       SET ${fields.join(", ")}
       WHERE id = ?`,
      params
    );

    res.json({ message: "Promotion updated" });
  } catch (err) {
    console.error("Update promotion error:", err);
    res.status(500).json({ message: "Failed to update promotion" });
  }
});

/**
 * Activate promotion
 */
router.put("/:id/activate", async (req, res) => {
  try {
    const { id } = req.params;
    await query(`UPDATE promotions SET active = 0`);
    await query(`UPDATE promotions SET active = 1 WHERE id = ?`, [id]);
    res.json({ message: "Promotion activated" });
  } catch (err) {
    console.error("Activate promotion error:", err);
    res.status(500).json({ message: "Failed to activate promotion" });
  }
});

/**
 * Delete promotion
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await query(`DELETE FROM promotions WHERE id = ?`, [id]);
    res.json({ message: "Promotion deleted" });
  } catch (err) {
    console.error("Delete promotion error:", err);
    res.status(500).json({ message: "Failed to delete promotion" });
  }
});

export default router;
