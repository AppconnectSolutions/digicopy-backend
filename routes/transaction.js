import express from "express";
import { query } from "./dbHelper.js";

const router = express.Router();

/**
 * Cycle loyalty calculation:
 * - Only PAID pages advance progress toward buyQty
 * - Free pages are consumed first ONLY if applyOffer = true
 * - Newly earned free pages can be consumed immediately if applyOffer = true
 */
/* =================== LOYALTY SIMULATOR =================== */
function simulateCycleLoyalty({
  qty,
  buyQty,
  freeQty,
  applyOffer,
  progressPaid,
  freeBalance,
}) {
  let remaining = Math.max(Math.floor(qty), 0);
  let paid = 0;
  let freeUsed = 0;
  let earned = 0;

  let progress = Math.max(progressPaid, 0);
  let freeBal = Math.max(freeBalance, 0);

  if (applyOffer && freeBal > 0) {
    const use = Math.min(remaining, freeBal);
    freeUsed += use;
    freeBal -= use;
    remaining -= use;
  }

  while (remaining > 0) {
    const toCycleEnd = buyQty - progress;
    const payNow = Math.min(remaining, toCycleEnd);

    paid += payNow;
    progress += payNow;
    remaining -= payNow;

    if (progress === buyQty) {
      earned += freeQty;
      freeBal += freeQty;
      progress = 0;

      if (applyOffer && freeBal > 0 && remaining > 0) {
        const use = Math.min(remaining, freeBal);
        freeUsed += use;
        freeBal -= use;
        remaining -= use;
      }
    }
  }

  return { paid, freeUsed, earned, progress, freeBal };
}

/* =================== ROLE-BASED OFFER =================== */
async function getXeroxOfferForRole(roleIdRaw) {
  const roleId = roleIdRaw ?? 0;

  const [[row]] = await query(
    `
    SELECT 
      o.product_id,
      o.buy_quantity,
      o.free_quantity,
      o.role_id
    FROM offers o
    JOIN products p ON p.id = o.product_id
    WHERE o.active = 1
      AND LOWER(TRIM(p.name)) LIKE '%xerox%'
      AND COALESCE(o.role_id,0) IN (0, ?)
    ORDER BY (COALESCE(o.role_id,0) = ?) DESC
    LIMIT 1
    `,
    [roleId, roleId]
  );

  return row || null;
}

/* =================== CREATE TRANSACTION =================== */
router.post("/create", async (req, res) => {
  const { customerMobile, items } = req.body;
  const applyOffer = req.body.applyOffer !== false;

  if (!customerMobile || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ message: "Invalid request" });
  }

  try {
    /* ---- CUSTOMER ---- */
    const [[customer]] = await query(
      "SELECT id, role_id FROM customers WHERE mobile = ?",
      [customerMobile]
    );
    if (!customer) return res.status(404).json({ message: "Customer not found" });

    const offer = await getXeroxOfferForRole(customer.role_id);
    const offerValid = offer && offer.buy_quantity > 0 && offer.free_quantity > 0;

    /* ---- REWARDS ---- */
    let [[reward]] = await query(
      "SELECT * FROM customer_rewards WHERE customer_id = ?",
      [customer.id]
    );

    if (!reward) {
      await query(
        `INSERT INTO customer_rewards
         (customer_id, total_xerox_pages, free_xerox_pages, pages_used)
         VALUES (?,0,0,0)`,
        [customer.id]
      );
      [[reward]] = await query(
        "SELECT * FROM customer_rewards WHERE customer_id = ?",
        [customer.id]
      );
    }

    const freeBalance =
      Math.max(reward.free_xerox_pages - reward.pages_used, 0);
    const paidTotal =
      Math.max(reward.total_xerox_pages - reward.pages_used, 0);

    let progress =
      offerValid ? paidTotal % offer.buy_quantity : 0;
    let freeBal = freeBalance;

    /* ---- TRANSACTION HEADER ---- */
    const [tx] = await query(
      "INSERT INTO transactions (customer_id, total_amount) VALUES (?,0)",
      [customer.id]
    );
    const txId = tx.insertId;

    let totalAmount = 0;
    let xeroxRequested = 0;
    let xeroxFreeUsed = 0;
    let xeroxFreeEarned = 0;

    /* ---- ITEMS ---- */
    for (const item of items) {
      const qty = Number(item.quantity);
      const price = Number(item.price);
      const isXerox =
  Number(item.id) === Number(offer?.product_id);


      let paidQty = qty;
      let freeQtyUsed = 0;
      let earnedFree = 0;

      if (isXerox) {
        const sim = simulateCycleLoyalty({
          qty,
          buyQty: offer.buy_quantity,
          freeQty: offer.free_quantity,
          applyOffer,
          progressPaid: progress,
          freeBalance: freeBal,
        });

        paidQty = sim.paid;
        freeQtyUsed = sim.freeUsed;
        earnedFree = sim.earned;
        progress = sim.progress;
        freeBal = sim.freeBal;

        xeroxRequested += qty;
        xeroxFreeUsed += freeQtyUsed;
        xeroxFreeEarned += earnedFree;
      }

      totalAmount += paidQty * price;

      await query(
        `INSERT INTO transaction_items
         (transaction_id, product_id, quantity, paid_qty, free_qty, price)
         VALUES (?,?,?,?,?,?)`,
        [txId, item.id, qty, paidQty, freeQtyUsed, price]
      );
    }

    /* ---- UPDATE TOTAL ---- */
    await query(
      "UPDATE transactions SET total_amount=? WHERE id=?",
      [totalAmount, txId]
    );

    /* ---- UPDATE REWARDS ---- */
    if (xeroxRequested > 0) {
      await query(
        `UPDATE customer_rewards
         SET total_xerox_pages = total_xerox_pages + ?,
             free_xerox_pages  = free_xerox_pages + ?,
             pages_used        = pages_used + ?
         WHERE customer_id = ?`,
        [xeroxRequested, xeroxFreeEarned, xeroxFreeUsed, customer.id]
      );
    }

    res.json({
      transactionId: txId,
      totalAmount,
      offerApplied: applyOffer,
      offer,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Transaction failed" });
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
         ti.paid_qty,
         ti.free_qty,
         ti.price AS unit_price,
         (ti.paid_qty * ti.price) AS line_total,
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
    const [customerRows] = await query(
  `
  SELECT
    c.id,
    c.name,
    c.mobile,
    c.role_id,
    r.role_name
  FROM customers c
  LEFT JOIN roles r ON r.id = c.role_id
  WHERE c.mobile = ?
  `,
  [mobile]
);

    if (!customerRows.length) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const customerId = customerRows[0].id;
const [[pageStats]] = await query(
  `
  SELECT
    COALESCE(SUM(ti.paid_qty + ti.free_qty), 0) AS totalPages,
    COUNT(DISTINCT t.id) AS transactionCount
  FROM transactions t
  JOIN transaction_items ti ON ti.transaction_id = t.id
  WHERE t.customer_id = ?
  `,
  [customerId]
);


    const roleId =
  customerRows[0].role_id === null ||
  customerRows[0].role_id === undefined
    ? null
    : Number(customerRows[0].role_id);


    const [transactions] = await query(
      `SELECT id AS transactionId, total_amount AS totalAmount, created_at AS date
       FROM transactions
       WHERE customer_id = ?
       ORDER BY created_at DESC`,
      [customerId]
    );

    const xeroxOffer = await getXeroxOfferForRole(roleId);

    const offerProductId = xeroxOffer?.productId || null;
    const buyQty = Number(xeroxOffer?.buy_quantity || 0);
    const freeQty = Number(xeroxOffer?.free_quantity || 0);

    let [[reward]] = await query(
      "SELECT * FROM customer_rewards WHERE customer_id = ?",
      [customerId]
    );

    if (!reward) {
      await query(
        `INSERT INTO customer_rewards (customer_id, total_xerox_pages, free_xerox_pages, pages_used)
         VALUES (?, 0, 0, 0)`,
        [customerId]
      );
      [[reward]] = await query(
        "SELECT * FROM customer_rewards WHERE customer_id = ?",
        [customerId]
      );
    }

    const totalPrinted = Number(reward.total_xerox_pages || 0);
    const freeEarned = Number(reward.free_xerox_pages || 0);
    const freeUsed = Number(reward.pages_used || 0);

    const free_remaining = Math.max(freeEarned - freeUsed, 0);
    const paid_total = Math.max(totalPrinted - freeUsed, 0);

    const cycle_progress = buyQty > 0 ? paid_total % buyQty : 0;
    const cycle_count = buyQty > 0 ? Math.floor(paid_total / buyQty) : 0;
    const next_unlock_in = buyQty > 0 ? buyQty - cycle_progress : 0;

  const customer = {
  id: customerRows[0].id,
  name: customerRows[0].name,
  mobile: customerRows[0].mobile,
  role_id: roleId,
  role_name: customerRows[0].role_name || "All",
};

res.json({
  customer,
  transactions,
  pageStats: {
    totalPages: Number(pageStats.totalPages),
    transactionCount: Number(pageStats.transactionCount),
  },
  rewards: {
    xerox: {
      offer_product_id: offerProductId,
      totalPrinted,
      paid_total,
      free_remaining,
      buy_quantity: buyQty,
      free_quantity: freeQty,
      cycle_progress,
      cycle_count,
      next_unlock_in,
    },
  },
});


  } catch (err) {
    console.error("Fetch customer transactions error:", err);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

/* ------------------- GET FULL TRANSACTION (INVOICE) ------------------- */
router.get("/:transactionId", async (req, res) => {
  const { transactionId } = req.params;

  try {
    const [[tx]] = await query(
      `
      SELECT
        t.id AS transactionId,
        t.total_amount AS totalAmount,
        t.created_at AS date,
        c.name AS customerName,
        c.mobile
      FROM transactions t
      JOIN customers c ON c.id = t.customer_id
      WHERE t.id = ?
      `,
      [transactionId]
    );

    if (!tx) {
      return res.status(404).json({ message: "Transaction not found" });
    }

  const [items] = await query(
  `
  SELECT
    ti.product_id,
    p.name,
    ti.quantity,
    ti.paid_qty,
    ti.free_qty,
    ti.price,
    (ti.paid_qty * ti.price) AS line_total,
    (ti.free_qty * ti.price) AS discount_amount
  FROM transaction_items ti
  JOIN products p ON p.id = ti.product_id
  WHERE ti.transaction_id = ?
  `,
  [transactionId]
);
let xeroxRequested = 0;
let xeroxPaid = 0;
let xeroxFreeUsed = 0;
let discount = 0;

for (const it of items) {
  xeroxRequested += Number(it.quantity || 0);
  xeroxPaid += Number(it.paid_qty || 0);
  xeroxFreeUsed += Number(it.free_qty || 0);
  discount += Number(it.discount_amount || 0);
}



    res.json({
  transaction: {
    ...tx,
    items,

    // Xerox summary
    xeroxRequested,
    xeroxPaid,
    xeroxFreeUsed,

    // Money saved from offer
    discount,
  },
});

  } catch (err) {
    console.error("Fetch transaction error:", err);
    res.status(500).json({ message: "Failed to fetch transaction" });
  }
});


export default router;
