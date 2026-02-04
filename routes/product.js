import express from "express";
import { query } from "./dbHelper.js";

const router = express.Router();

/* ------------------- FETCH ALL PRODUCTS ------------------- */
router.get("/", async (req, res) => {
  try {
    // 1️⃣ Fetch all products
    const [products] = await query(
  "SELECT * FROM products WHERE active = 1"
);


    // 2️⃣ Fetch active offers
    const [offers] = await query(
      `SELECT o.product_id, o.buy_quantity, o.free_quantity
       FROM offers o
       WHERE o.active = 1`
    );

    // 3️⃣ Map offers to products
    const productsWithOffers = products.map((p) => {
      const offer = offers.find((o) => o.product_id === p.id);
      return {
        ...p,
        offer: offer
          ? {
              buy_quantity: offer.buy_quantity,
              free_quantity: offer.free_quantity,
            }
          : null,
      };
    });

    res.json(productsWithOffers);
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
      "UPDATE products SET active = 0 WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product deactivated", id });
  } catch (err) {
    console.error("Error deactivating product:", err);
    res.status(500).json({ message: "Error deactivating product" });
  }
});

router.get("/inactive", async (req, res) => {
  const [products] = await query(
    "SELECT * FROM products WHERE active = 0"
  );
  res.json(products);
});

router.put("/:id/restore", async (req, res) => {
  const { id } = req.params;

  try {
    await query("UPDATE products SET active = 1 WHERE id = ?", [id]);
    res.json({ message: "Product activated", id });
  } catch (err) {
    res.status(500).json({ message: "Error restoring product" });
  }
});

export default router;
