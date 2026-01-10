import express from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import csv from "csv-parser";
import fs from "fs";
import { query } from "./dbHelper.js"; // ✅ SAME STYLE AS product.js

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Helper: generate default password
const generateDefaultPassword = (mobile) =>
  mobile.toString().slice(-4);

/* ------------------- REGISTER ------------------- */
router.post("/register", async (req, res) => {
  try {
    const { name, email, mobile, password } = req.body;

    if (!name || !email || !mobile || !password) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const [existing] = await query(
      "SELECT id FROM customers WHERE email=? OR mobile=?",
      [email, mobile]
    );

    if (existing.length > 0) {
      return res
        .status(400)
        .json({ message: "Email or mobile already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await query(
      `INSERT INTO customers
       (name, email, mobile, password_hash, tier, points_balance, password_set, force_password_change)
       VALUES (?, ?, ?, ?, 'Silver', 0, 1, 0)`,
      [name, email, mobile, hashedPassword]
    );

    res.status(201).json({
      message: "Customer registered successfully",
      customer: {
        id: result.insertId,
        name,
        email,
        mobile,
        tier: "Silver",
        points_balance: 0,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Registration failed", error: err.message });
  }
});

/* ------------------- UPLOAD CUSTOMERS (CSV) ------------------- */
router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const customers = [];

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on("data", (row) => {
      if (!row.mobile) return;

      customers.push({
        name: row.name,
        email: row.email,
        mobile: row.mobile.toString(),
        password: generateDefaultPassword(row.mobile),
      });
    })
    .on("end", async () => {
      try {
        for (const c of customers) {
          if (!c.name || !c.mobile) continue;

          const [exists] = await query(
            "SELECT id FROM customers WHERE email=? OR mobile=?",
            [c.email, c.mobile]
          );

          if (exists.length) continue;

          const hashedPassword = await bcrypt.hash(c.password, 10);

          await query(
            `INSERT INTO customers
             (name, email, mobile, password_hash, tier, points_balance, password_set, force_password_change)
             VALUES (?, ?, ?, ?, 'Silver', 0, 1, 1)`,
            [c.name, c.email, c.mobile, hashedPassword]
          );
        }

        fs.unlink(req.file.path, () => {});
        res.json({ message: "Customers uploaded successfully" });
      } catch (err) {
        console.error("Upload error:", err);
        res.status(500).json({ message: "Customer upload failed", error: err.message });
      }
    })
    .on("error", (err) => {
      console.error("CSV error:", err);
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ message: "Invalid CSV file" });
    });
});

/* ------------------- LOGIN ------------------- */
router.post("/login", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    const [rows] = await query(
      "SELECT * FROM customers WHERE mobile=?",
      [mobile]
    );

    if (!rows.length) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const customer = rows[0];
    const isMatch = await bcrypt.compare(password, customer.password_hash);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    res.json({
      message: "Login successful",
      customer: {
        id: customer.id,
        name: customer.name,
        mobile: customer.mobile,
        tier: customer.tier,
        points_balance: customer.points_balance,
      },
      forcePasswordChange: customer.force_password_change === 1,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

/* ------------------- GET ALL CUSTOMERS ------------------- */
router.get("/", async (req, res) => {
  try {
    const [rows] = await query(`
      SELECT
        c.id,
        c.name,
        c.email,
        c.mobile,
        c.tier,
        c.points_balance,
        IFNULL(SUM(ti.quantity), 0) AS printCount
      FROM customers c
      LEFT JOIN transactions t ON t.customer_id = c.id
      LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
      GROUP BY c.id
      ORDER BY c.id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Fetch customers error:", err);
    res.status(500).json({ message: "Failed to fetch customers", error: err.message });
  }
});

/* ------------------- ADMIN ADD CUSTOMER ------------------- */
router.post("/admin-add", async (req, res) => {
  try {
    const { name, mobile } = req.body;

    if (!name || !mobile) {
      return res.status(400).json({ message: "Name and mobile required" });
    }

    const [exists] = await query(
      "SELECT id FROM customers WHERE mobile=?",
      [mobile]
    );

    if (exists.length > 0) {
      return res.status(409).json({ message: "Customer already exists" });
    }

    const defaultPassword = generateDefaultPassword(mobile);
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const [result] = await query(
      `INSERT INTO customers
       (name, email, mobile, password_hash, tier, points_balance)
       VALUES (?, NULL, ?, ?, 'Silver', 0)`,
      [name, mobile, hashedPassword]
    );

    res.json({
      id: result.insertId,
      name,
      mobile,
      defaultPassword, // ⚠️ remove in production
      forcePasswordChange: true,
    });
  } catch (err) {
    console.error("Admin add error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

/* ------------------- CHANGE PASSWORD ------------------- */
router.post("/change-password", async (req, res) => {
  try {
    const { customerId, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: "Password too short" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await query(
      "UPDATE customers SET password_hash=?, force_password_change=0 WHERE id=?",
      [hashed, customerId]
    );

    res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({ message: "Password change failed", error: err.message });
  }
});

export default router;
