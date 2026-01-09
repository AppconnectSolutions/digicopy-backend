import express from "express";
import { query } from "./dbHelper.js";

const router = express.Router();

/* ------------------- CREATE TRANSACTION ------------------- */
router.post("/create", async (req, res) => {
  const { customerMobile, items } = req.body;

  if (!customerMobile || !items || items.length === 0) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // 1️⃣ Find customer
    const [customerRows] = await query(
      "SELECT id FROM customers WHERE mobile = ?",
      [customerMobile]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customerId = customerRows[0].id;

    // 2️⃣ Calculate total amount
    let totalAmount = 0;
    for (const item of items) {
      totalAmount += item.price * item.quantity;
    }

    // 3️⃣ Insert transaction
    const [transactionResult] = await query(
      "INSERT INTO transactions (customer_id, total_amount) VALUES (?, ?)",
      [customerId, totalAmount]
    );

    const transactionId = transactionResult.insertId;

    // 4️⃣ Insert transaction items + rewards
    for (const item of items) {
      const totalPrice = item.price * item.quantity;

      await query(
        `INSERT INTO transaction_items
         (transaction_id, product_id, quantity, price)
         VALUES (?, ?, ?, ?)`,
        [transactionId, item.id, item.quantity, totalPrice]
      );

      // ✅ Update customer_rewards for xerox
      
        
      
    }

    res.status(201).json({
      message: "Transaction saved",
      transactionId,
    });
  } catch (err) {
    console.error("Transaction error:", err);
    res.status(500).json({ message: "Failed to save transaction" });
  }
});

/* ------------------- GET ITEMS BY TRANSACTION ------------------- */
router.get("/items/:transactionId", async (req, res) => {
  const { transactionId } = req.params;

  try {
    const [rows] = await query(
      `SELECT 
         ti.id,
         ti.product_id,
         ti.quantity,
         ti.price,
         p.name AS productName
       FROM transaction_items ti
       JOIN products p ON p.id = ti.product_id
       WHERE ti.transaction_id = ?`,
      [transactionId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Fetch transaction items error:", err);
    res.status(500).json({ message: "Failed to fetch transaction items" });
  }
});

/* ------------------- GET CUSTOMER TRANSACTIONS + REWARDS ------------------- */
router.get("/customer/:mobile", async (req, res) => {
  const { mobile } = req.params;

  try {
    // 1️⃣ Get customer
    const [customerRows] = await query(
      "SELECT id, name FROM customers WHERE mobile = ?",
      [mobile]
    );

    if (customerRows.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customerId = customerRows[0].id;

    // 2️⃣ Get transactions
    const [transactions] = await query(
      `SELECT 
         t.id AS transactionId,
         t.total_amount AS totalAmount,
         t.created_at AS date
       FROM transactions t
       WHERE t.customer_id = ?
       ORDER BY t.created_at DESC`,
      [customerId]
    );

    // 3️⃣ Get active offers
    const [offerRows] = await query(
      `SELECT 
         p.id AS productId,
         p.name AS productName,
         o.buy_quantity,
         o.free_quantity
       FROM offers o
       JOIN products p ON p.id = o.product_id
       WHERE o.active = 1`
    );

    // 4️⃣ Calculate rewards
    const rewards = {};

    for (const offer of offerRows) {
      const [[totalResult]] = await query(
        `SELECT IFNULL(SUM(ti.quantity), 0) AS total_quantity
         FROM transactions t
         JOIN transaction_items ti ON t.id = ti.transaction_id
         WHERE t.customer_id = ? AND ti.product_id = ?`,
        [customerId, offer.productId]
      );

      const totalPurchased = totalResult.total_quantity || 0;
      const blocks = Math.floor(totalPurchased / offer.buy_quantity);
      const freeEarned = blocks * offer.free_quantity;
      const extraUsed = totalPurchased - blocks * offer.buy_quantity;
      const remainingFree = Math.max(freeEarned - extraUsed, 0);

      rewards[offer.productName.toLowerCase()] = {
        total: totalPurchased,
        free: freeEarned,
        remaining: remainingFree,
        buy_quantity: offer.buy_quantity,
        free_quantity: offer.free_quantity,
      };
    }

    res.json({
      customer: customerRows[0],
      transactions,
      rewards,
    });
  } catch (err) {
    console.error("Fetch customer transactions error:", err);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});





export default router;
