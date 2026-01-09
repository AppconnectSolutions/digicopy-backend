import express from "express";
import { query } from "./dbHelper.js";

const router = express.Router();

/* ------------------- FETCH ALL PRODUCTS ------------------- */
router.get("/", async (req, res) => {
  try {
    const [rows] = await query("SELECT * FROM products");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ message: "Error fetching products" });
  }
});

/* ------------------- ADD NEW PRODUCT ------------------- */
router.post("/", async (req, res) => {
  const { name, price, category } = req.body;

  if (!name || !price || !category) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const [result] = await query(
      "INSERT INTO products (name, price, category) VALUES (?, ?, ?)",
      [name, price, category]
    );

    res.status(201).json({
      product: {
        id: result.insertId,
        name,
        price,
        category,
      },
    });
  } catch (err) {
    console.error("Error inserting product:", err);
    res.status(500).json({ message: "Error adding product" });
  }
});

/* ------------------- UPDATE PRODUCT ------------------- */
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, price, category } = req.body;

  if (!name || !price || !category) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const [result] = await query(
      "UPDATE products SET name = ?, price = ?, category = ? WHERE id = ?",
      [name, price, category, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({
      product: { id, name, price, category },
    });
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).json({ message: "Error updating product" });
  }
});

/* ------------------- DELETE PRODUCT ------------------- */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await query(
      "DELETE FROM products WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product deleted", id });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ message: "Error deleting product" });
  }
});

export default router;
