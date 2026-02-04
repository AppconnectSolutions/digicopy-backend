import express from "express";
import { query } from "./dbHelper.js";

const router = express.Router();

/* ================= DASHBOARD SUMMARY ================= */
router.get("/summary", async (req, res) => {
  try {
    const [[stats]] = await query(`
      SELECT
        (SELECT COUNT(*) FROM customers WHERE is_active = 1) AS totalCustomers,

        (SELECT IFNULL(SUM(total_amount),0)
         FROM transactions
         WHERE DATE(created_at) = CURDATE()) AS todaySales,

        (SELECT COUNT(*)
         FROM transactions
         WHERE DATE(created_at) = CURDATE()) AS todayTransactions,

        (SELECT IFNULL(SUM(points_balance),0)
         FROM customers) AS pointsLiability
    `);

    const [todayProducts] = await query(`
      SELECT
        p.name AS product,
        SUM(ti.quantity) AS qty,
        SUM(ti.paid_qty * ti.price) AS amount
      FROM transactions t
      JOIN transaction_items ti ON ti.transaction_id = t.id
      JOIN products p ON p.id = ti.product_id
      WHERE DATE(t.created_at) = CURDATE()
      GROUP BY p.name
      ORDER BY amount DESC
    `);

    const [recentTransactions] = await query(`
      SELECT
        t.id,
        c.name AS customer_name,
        t.total_amount,
        t.created_at
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      ORDER BY t.created_at DESC
      LIMIT 8
    `);

    res.json({
      stats,
      todayProducts,
      recentTransactions,
    });
  } catch (err) {
    console.error("Dashboard summary error:", err);
    res.status(500).json({ message: "Dashboard load failed" });
  }
});

export default router;
