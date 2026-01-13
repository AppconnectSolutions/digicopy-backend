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
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const customers = [];

  // Parse CSV
  fs.createReadStream(req.file.path)
    .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() })) // normalize headers
    .on("data", (row) => {
      if (!row.mobile) return; // skip rows without mobile

      customers.push({
         name: row.name ? row.name.trim() : null,
        email: row.email || null,
        mobile: row.mobile.toString().trim(),
        password: generateDefaultPassword(row.mobile), // your existing function
      });
    })
    .on("end", async () => {
      try {
        if (customers.length === 0) {
          fs.unlink(req.file.path, () => {});
          return res.status(400).json({ message: "No valid customers in CSV" });
        }

        // Get all existing mobiles in one query
        const mobiles = customers.map(c => c.mobile);
        const [existingRows] = await query(
          `SELECT mobile FROM customers WHERE mobile IN (?)`,
          [mobiles]
        );
        const existingMobiles = new Set(existingRows.map(r => r.mobile));

        // Prepare batch insert
        const rowsToInsert = [];
        for (const c of customers) {
          if (existingMobiles.has(c.mobile)) continue; // skip duplicates
          const hashedPassword = await bcrypt.hash(c.password, 10);
          rowsToInsert.push([
            c.name,
            c.email,
            c.mobile,
            hashedPassword,
            'Silver', // tier default
            0,        // points_balance default
            1,        // password_set
            0         // force_password_change default as per your table
          ]);
        }

        // Only insert if there are rows
        if (rowsToInsert.length > 0) {
          await query(
            `INSERT INTO customers
             (name, email, mobile, password_hash, tier, points_balance, password_set, force_password_change)
             VALUES ?`,
            [rowsToInsert]
          );
        }

        fs.unlink(req.file.path, () => {}); // delete CSV
        res.json({ 
          message: `Upload finished. ${rowsToInsert.length} customers added.` 
        });

      } catch (err) {
        console.error("Upload DB Error:", err);
        fs.unlink(req.file.path, () => {});
        res.status(500).json({ message: "Customer upload failed", error: err.message });
      }
    })
    .on("error", (err) => {
      console.error("CSV parse error:", err);
      fs.unlink(req.file.path, () => {});
      res.status(400).json({ message: "Invalid CSV file", error: err.message });
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
/* ------------------- ADMIN ADD / UPDATE CUSTOMER ------------------- */
router.post("/admin-add", async (req, res) => {
  try {
    const { name, mobile } = req.body;

    if (!mobile) {
      return res.status(400).json({ message: "Mobile number is required" });
    }

    // Check if customer exists
    const [rows] = await query(
      "SELECT id, name FROM customers WHERE mobile=?",
      [mobile]
    );

    let customer;
    let action = "";

    if (rows.length > 0) {
      customer = rows[0];

      if (!customer.name || customer.name.trim() === "") {
        // Update existing customer name
        await query("UPDATE customers SET name=? WHERE id=?", [name, customer.id]);
        action = "updated";
        customer.name = name; // update locally
      } else {
        // Already exists with a name, just select
        action = "exists";
      }
    } else {
      // Create new customer
      const defaultPassword = mobile.slice(-4);
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);

      const [result] = await query(
        `INSERT INTO customers
         (name, email, mobile, password_hash, tier, points_balance, password_set, force_password_change)
         VALUES (?, NULL, ?, ?, 'Silver', 0, 1, 0)`,
        [name, mobile, hashedPassword]
      );

      customer = { id: result.insertId, name, mobile };
      action = "created";
    }

    res.json({
      customer,
      action,
      defaultPassword: action === "created" ? mobile.slice(-4) : undefined,
    });
  } catch (err) {
    console.error("Admin add/update error:", err);
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
