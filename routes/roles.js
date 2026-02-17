import express from "express";
import { query } from "./dbHelper.js";


const router = express.Router();

/* ============================
   GET ALL ROLES
============================ */
router.get("/", async (req, res) => {
  try {
    const [rows] = await query(
      `SELECT
         id,
         role_name,
         description,
         created_at
       FROM roles
       ORDER BY id DESC`
    );

    // ✅ Always return ARRAY
    res.json(rows);
  } catch (err) {
    console.error("Fetch roles error:", err);
    res.status(500).json({ message: "Failed to fetch roles" });
  }
});

/* ============================
   CREATE NEW ROLE
============================ */
router.post("/", async (req, res) => {
  const { role_name, description } = req.body;

  if (!role_name || !role_name.trim()) {
    return res.status(400).json({ message: "Role name is required" });
  }

  try {
    await query(
      `INSERT INTO roles (role_name, description)
       VALUES (?, ?)`,
      [role_name.trim(), description || null]
    );

    res.status(201).json({ message: "Role created successfully" });
  } catch (err) {
    console.error("Create role error:", err);

    // Handle duplicate role_name (UNIQUE)
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Role already exists" });
    }

    res.status(500).json({ message: "Failed to create role" });
  }
});

export default router;
