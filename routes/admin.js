import express from "express";
import bcrypt from "bcryptjs";

import { query } from "./dbHelper.js";

const router = express.Router();


/* ================= ADMIN LOGIN ================= */
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const [[admin]] = await query(
    `SELECT id, email, password_hash, role_id 
     FROM admins 
     WHERE email = ?`,
    [email]
  );

  if (!admin) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const match = await bcrypt.compare(password, admin.password_hash);
  if (!match) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  res.json({
    message: "Login successful",
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role_id === 1 ? "ADMIN" : "STAFF",
    },
  });
});


/* ================= CREATE ADMIN / STAFF ================= */
router.post("/users", async (req, res) => {
  try {
    const { email, password, role_id } = req.body;

    if (!email || !password || !role_id) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // check duplicate email
    const [[existing]] = await query(
      "SELECT id FROM admins WHERE email = ?",
      [email]
    );

    if (existing) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hash = await bcrypt.hash(password, 10);

    await query(
      `
      INSERT INTO admins (email, password_hash, role_id, approved)
      VALUES (?,?,?,0)
      `,
      [email, hash, role_id]
    );

    res.json({ message: "User created successfully" });
  } catch (err) {
    console.error("Create admin user error:", err);
    res.status(500).json({ message: "Failed to create user" });
  }
});

export default router;
