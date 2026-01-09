import express from "express";
import { pool } from "../db.js"; // ✅ promise-based pool

const router = express.Router();

/* ------------------- GET ALL OFFERS ------------------- */
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        o.id, 
        o.product_id, 
        o.buy_quantity, 
        o.free_quantity, 
        o.active,
        p.name AS productName
      FROM offers o
      LEFT JOIN products p ON p.id = o.product_id
      ORDER BY o.id DESC
    `);

    const formattedRows = rows.map(offer => ({
      ...offer,
      productName: offer.productName || "Product not found"
    }));

    res.json(formattedRows);
  } catch (err) {
    console.error("Fetch offers error:", err);
    res.status(500).json({ message: "Failed to fetch offers", error: err.message });
  }
});

/* ------------------- CREATE OFFER ------------------- */
router.post("/", async (req, res) => {
  const { productId, buyQuantity, freeQuantity } = req.body;

  if (!productId || !buyQuantity || !freeQuantity) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO offers (product_id, buy_quantity, free_quantity) VALUES (?, ?, ?)`,
      [productId, buyQuantity, freeQuantity]
    );

    res.status(201).json({ message: "Offer created", offerId: result.insertId });
  } catch (err) {
    console.error("Create offer error:", err);
    res.status(500).json({ message: "Failed to create offer", error: err.message });
  }
});

/* ------------------- UPDATE OFFER ------------------- */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { productId, buyQuantity, freeQuantity } = req.body;

  if (!productId || !buyQuantity || !freeQuantity) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const [result] = await pool.query(
      `UPDATE offers SET product_id = ?, buy_quantity = ?, free_quantity = ? WHERE id = ?`,
      [productId, buyQuantity, freeQuantity, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Offer not found" });
    }

    res.json({ message: "Offer updated" });
  } catch (err) {
    console.error("Update offer error:", err);
    res.status(500).json({ message: "Failed to update offer", error: err.message });
  }
});

/* ------------------- DELETE OFFER ------------------- */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query(
      `DELETE FROM offers WHERE id = ?`,
      [id]
    );

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
