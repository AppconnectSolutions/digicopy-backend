import express from "express";
import { pool } from "../db.js"; 

const router = express.Router();

function toInt(v) {
  return v === null || v === "" ? null : Number(v);
}
const toIntOrNull = (val) => {
  if (val === undefined || val === null || val === "") return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
};
const validateRoleId = async (roleId) => {
  if (roleId == null) return true; // NULL = common offer

  const [rows] = await pool.query(
    `SELECT id FROM roles WHERE id = ? AND is_active = 1`,
    [roleId]
  );

  return rows.length > 0;
};

/* =================== GET OFFERS =================== */
router.get("/", async (_, res) => {
  const [rows] = await pool.query(`
    SELECT 
      o.id, o.product_id, p.name productName,
      o.role_id, r.role_name roleName,
      o.buy_quantity, o.free_quantity, o.active
    FROM offers o
    LEFT JOIN products p ON p.id = o.product_id
    LEFT JOIN roles r ON r.id = o.role_id
    ORDER BY o.id DESC
  `);

  res.json(
    rows.map((r) => ({
      ...r,
      roleName: r.roleName || "All",
    }))
  );
});

/* =================== CREATE / UPSERT =================== */
router.post("/", async (req, res) => {
  const { product_id, buy_quantity, free_quantity, role_id } = req.body;

  const productId = toIntOrNull(product_id);
  const buyQty = toIntOrNull(buy_quantity);
  const freeQty = toIntOrNull(free_quantity);
  const roleId = toIntOrNull(role_id);

  if (!productId || !buyQty || !freeQty) {
    return res.status(400).json({ message: "Missing or invalid numeric fields" });
  }

  const okRole = await validateRoleId(roleId);
  if (!okRole) return res.status(400).json({ message: "Invalid role selected" });

  await pool.query(
    `INSERT INTO offers (product_id, role_id, buy_quantity, free_quantity, active)
     VALUES (?,?,?,?,1)
     ON DUPLICATE KEY UPDATE
       buy_quantity = VALUES(buy_quantity),
       free_quantity = VALUES(free_quantity),
       active = 1`,
    [productId, roleId, buyQty, freeQty]
  );

  res.status(201).json({ message: "Offer saved" });
});

/* ------------------- UPDATE OFFER (ALLOW ROLE CHANGE) ------------------- */
router.put("/:id", async (req, res) => {
  try {
    const id = toIntOrNull(req.params.id);
    const productId = toIntOrNull(req.body.product_id);
    const buyQuantity = toIntOrNull(req.body.buy_quantity);
    const freeQuantity = toIntOrNull(req.body.free_quantity);
    const roleId = toIntOrNull(req.body.role_id);

    if (!id) {
      return res.status(400).json({ message: "Invalid offer id" });
    }

    if (productId == null || buyQuantity == null || freeQuantity == null) {
      return res.status(400).json({ message: "Missing or invalid numeric fields" });
    }

    // Allow 0, but disallow negatives
    if (buyQuantity < 0 || freeQuantity < 0) {
      return res.status(400).json({ message: "Quantities must be >= 0" });
    }

    const okRole = await validateRoleId(roleId);
    if (!okRole) {
      return res.status(400).json({ message: "Invalid role selected" });
    }

    const [result] = await pool.query(
      `
      UPDATE offers
      SET product_id = ?, role_id = ?, buy_quantity = ?, free_quantity = ?
      WHERE id = ?
      `,
      [productId, roleId, buyQuantity, freeQuantity, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Offer not found" });
    }

    res.json({ message: "Offer updated" });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "Offer already exists for this product and role (duplicate)",
      });
    }
    console.error("Update offer error:", err);
    res.status(500).json({ message: "Failed to update offer", error: err.message });
  }
});


/* ------------------- DELETE OFFER ------------------- */
router.delete("/:id", async (req, res) => {
  try {
    const id = toIntOrNull(req.params.id);
    if (!id) return res.status(400).json({ message: "Invalid offer id" });

    const [result] = await pool.query(`DELETE FROM offers WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Offer not found" });
    }

    res.json({ message: "Offer deleted" });
  } catch (err) {
    console.error("Delete offer error:", err);
    res.status(500).json({ message: "Failed to delete offer", error: err.message });
  }
});

export default router;
