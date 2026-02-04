import express from "express";
import bcrypt from "bcryptjs";
import { query } from "./dbHelper.js";

const router = express.Router();

/* ================= HELPERS ================= */
const roleLabelFromId = (role_id) => {
  // keep your old logic for frontend compatibility
  return Number(role_id) === 1 ? "ADMIN" : "STAFF";
};

async function selectUsersSafe() {
  // Try: admins + roles + name
  try {
    const [rows] = await query(
      `
      SELECT 
        a.id,
        a.email,
        a.role_id,
        a.approved,
        a.name,
        r.role_name
      FROM admins a
      LEFT JOIN roles r ON r.id = a.role_id
      ORDER BY a.id DESC
      `
    );
    return rows;
  } catch (e1) {
    // Fallback 1: roles table might not exist OR name column might not exist
    try {
      const [rows] = await query(
        `
        SELECT 
          a.id,
          a.email,
          a.role_id,
          a.approved,
          NULL as name,
          NULL as role_name
        FROM admins a
        ORDER BY a.id DESC
        `
      );
      return rows;
    } catch (e2) {
      throw e2;
    }
  }
}

async function insertAdminSafe({ name, email, password, role_id }) {
  const hash = await bcrypt.hash(password, 10);

  // Try insert with name (if column exists)
  try {
    await query(
      `
      INSERT INTO admins (name, email, password_hash, role_id, approved)
      VALUES (?,?,?,?,0)
      `,
      [name || null, email, hash, role_id]
    );
    return true;
  } catch (e) {
    // Fallback: if "name" column doesn't exist, insert without it
    await query(
      `
      INSERT INTO admins (email, password_hash, role_id, approved)
      VALUES (?,?,?,0)
      `,
      [email, hash, role_id]
    );
    return true;
  }
}

/* ================= ADMIN LOGIN ================= */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [[admin]] = await query(
      `SELECT id, email, password_hash, role_id, approved
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

    // ✅ allow login always, just return approved status
    res.json({
      message: "Login successful",
      admin: {
        id: admin.id,
        email: admin.email,
        role_id: admin.role_id,
        role: admin.role_id === 1 ? "ADMIN" : "STAFF",
        approved: Number(admin.approved) === 1 ? 1 : 0, // ✅ THIS IS THE KEY
      },
    });
  } catch (err) {
    console.error("Admin login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


/* ================= CREATE ADMIN / STAFF ================= */
router.post("/users", async (req, res) => {
  try {
    const { name, email, password, role_id } = req.body;

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

    await insertAdminSafe({
      name,
      email,
      password,
      role_id: Number(role_id),
    });

    res.json({ message: "User created successfully (Approval pending)" });
  } catch (err) {
    console.error("Create admin user error:", err);
    res.status(500).json({ message: "Failed to create user" });
  }
});

/* ================= LIST ADMIN / STAFF USERS ================= */
router.get("/users", async (req, res) => {
  try {
    const rows = await selectUsersSafe();

    const users = rows.map((u) => ({
      id: u.id,
      name: u.name ?? null,
      email: u.email,
      role_id: u.role_id,
      role_name: u.role_name ?? null,
      role: roleLabelFromId(u.role_id),
      is_active: Number(u.approved) === 1 ? 1 : 0,
      approved: Number(u.approved) === 1 ? 1 : 0,
    }));

    res.json({ users });
  } catch (err) {
    console.error("List admin users error:", err);
    res.status(500).json({ message: "Failed to load users" });
  }
});

/* ================= GIVE ACCESS (approved = 1) ================= */
router.put("/users/:id/activate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid user id" });

    await query(`UPDATE admins SET approved = 1 WHERE id = ?`, [id]);

    res.json({ message: "Access granted" });
  } catch (err) {
    console.error("Activate user error:", err);
    res.status(500).json({ message: "Failed to activate user" });
  }
});

/* ================= REMOVE ACCESS (approved = 0) ================= */
router.put("/users/:id/deactivate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid user id" });

    await query(`UPDATE admins SET approved = 0 WHERE id = ?`, [id]);

    res.json({ message: "Access removed" });
  } catch (err) {
    console.error("Deactivate user error:", err);
    res.status(500).json({ message: "Failed to deactivate user" });
  }
});

export default router;
