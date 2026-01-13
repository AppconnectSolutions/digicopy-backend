import express from "express";
import { query } from "./dbHelper.js";

const router = express.Router();

/**
 * Cycle loyalty calculation:
 * - Only PAID pages advance progress toward buyQty
 * - Free pages are consumed first ONLY if applyOffer = true
 * - Newly earned free pages can be consumed immediately if applyOffer = true
 */
function simulateCycleLoyalty({
  qty,
  buyQty,
  freeQty,
  applyOffer,
  progressPaid,
  freeBalance,
}) {
  let remainingNeed = Math.max(Math.floor(Number(qty) || 0), 0);

  let paid = 0;
  let freeUsed = 0;
  let earned = 0;

  let progress = Math.max(Math.floor(Number(progressPaid) || 0), 0); // 0..buyQty-1
  let freeBal = Math.max(Math.floor(Number(freeBalance) || 0), 0);

  // Use existing free first if applyOffer ON
  if (applyOffer && freeBal > 0 && remainingNeed > 0) {
    const use = Math.min(remainingNeed, freeBal);
    freeUsed += use;
    freeBal -= use;
    remainingNeed -= use;
  }

  // Pay remaining pages; complete cycles to earn free
  while (remainingNeed > 0) {
    const toCycleEnd = buyQty - progress; // how many paid pages to complete cycle
    const payNow = Math.min(remainingNeed, toCycleEnd);

    paid += payNow;
    progress += payNow;
    remainingNeed -= payNow;

    // Cycle completed -> earn free pages
    if (progress === buyQty) {
      earned += freeQty;
      freeBal += freeQty;
      progress = 0;

      // ✅ KEY: If applyOffer ON, use newly earned free immediately
      if (applyOffer && freeBal > 0 && remainingNeed > 0) {
        const use = Math.min(remainingNeed, freeBal);
        freeUsed += use;
        freeBal -= use;
        remainingNeed -= use;
      }
    }
  }

  return { paid, freeUsed, earned, progress, freeBal };
}

/* ------------------- CREATE TRANSACTION ------------------- */
router.post("/create", async (req, res) => {
  const { customerMobile, items } = req.body;
  const applyOffer = Boolean(req.body.applyOffer);

  if (!customerMobile || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  for (const item of items) {
    const productId = item.id;
    const qty = Number(item.quantity);
    const price = Number(item.price);
    if (
      !productId ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      return res.status(400).json({ message: "Invalid product data", item });
    }
  }

  try {
    // 1) customer
    const [[customer]] = await query("SELECT id FROM customers WHERE mobile = ?", [
      customerMobile,
    ]);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    const customerId = customer.id;

    // 2) active xerox offer + product id (latest active one)
    const [[xeroxOffer]] = await query(
      `SELECT p.id AS productId, p.name AS productName, o.buy_quantity, o.free_quantity
       FROM offers o
       JOIN products p ON p.id = o.product_id
       WHERE o.active = 1 AND LOWER(TRIM(p.name)) LIKE '%xerox%'
       ORDER BY o.id DESC
       LIMIT 1`
    );

    const xeroxProductId = xeroxOffer?.productId || null;
    const buyQty = Number(xeroxOffer?.buy_quantity || 0);
    const freeQty = Number(xeroxOffer?.free_quantity || 0);

    const offerValid = xeroxProductId && buyQty > 0 && freeQty > 0;

    // 3) rewards row
    let [[reward]] = await query("SELECT * FROM customer_rewards WHERE customer_id = ?", [
      customerId,
    ]);

    if (!reward) {
      await query(
        `INSERT INTO customer_rewards (customer_id, total_xerox_pages, free_xerox_pages, pages_used)
         VALUES (?, 0, 0, 0)`,
        [customerId]
      );
      [[reward]] = await query("SELECT * FROM customer_rewards WHERE customer_id = ?", [
        customerId,
      ]);
    }

    const totalPrintedBefore = Number(reward.total_xerox_pages || 0);
    const freeEarnedBefore = Number(reward.free_xerox_pages || 0);
    const freeUsedBefore = Number(reward.pages_used || 0);

    const freeBalanceBefore = Math.max(freeEarnedBefore - freeUsedBefore, 0);
    const paidTotalBefore = Math.max(totalPrintedBefore - freeUsedBefore, 0);
    const progressPaidBefore = offerValid ? paidTotalBefore % buyQty : 0;

    // running state for multiple xerox lines in same bill
    let runningFreeBal = freeBalanceBefore;
    let runningProgress = progressPaidBefore;

    // 4) create transaction header
    const [txRes] = await query(
      "INSERT INTO transactions (customer_id, total_amount) VALUES (?, 0)",
      [customerId]
    );
    const transactionId = txRes.insertId;

    let transactionTotal = 0;

    let xeroxRequested = 0;
    let xeroxFreeUsedTx = 0;
    let xeroxFreeEarnedTx = 0;
    let xeroxPaidTx = 0;

    // 5) insert line items
    for (const item of items) {
      const productId = item.id;
      const name = (item.name || "").trim().toLowerCase();
      const requestedQty = Math.floor(Number(item.quantity));
      const unitPrice = Number(item.price);

      const isXerox = offerValid ? productId === xeroxProductId : name.includes("xerox");

      let paidQty = requestedQty;
      let freeQtyUsed = 0;
      let earnedFree = 0;

      if (isXerox && offerValid) {
        const sim = simulateCycleLoyalty({
          qty: requestedQty,
          buyQty,
          freeQty,
          applyOffer,
          progressPaid: runningProgress,
          freeBalance: runningFreeBal,
        });

        paidQty = sim.paid;
        freeQtyUsed = sim.freeUsed;
        earnedFree = sim.earned;

        runningProgress = sim.progress;
        runningFreeBal = sim.freeBal;

        xeroxRequested += requestedQty;
        xeroxFreeUsedTx += freeQtyUsed;
        xeroxFreeEarnedTx += earnedFree;
        xeroxPaidTx += paidQty;
      }

      const lineTotal = paidQty * unitPrice;
      transactionTotal += lineTotal;

      await query(
        `INSERT INTO transaction_items
         (transaction_id, product_id, quantity, paid_qty, free_qty, price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [transactionId, productId, requestedQty, paidQty, freeQtyUsed, unitPrice]
      );
    }

    // 6) update transaction total
    await query("UPDATE transactions SET total_amount = ? WHERE id = ?", [
      transactionTotal,
      transactionId,
    ]);

    // 7) update rewards for xerox
    if (xeroxRequested > 0) {
      await query(
        `UPDATE customer_rewards
         SET total_xerox_pages = total_xerox_pages + ?,
             free_xerox_pages  = free_xerox_pages + ?,
             pages_used        = pages_used + ?
         WHERE customer_id = ?`,
        [xeroxRequested, xeroxFreeEarnedTx, xeroxFreeUsedTx, customerId]
      );
    }

    // ✅ return summary to show in invoice if you want
    res.status(201).json({
      message: "Transaction saved correctly",
      transactionId,
      totalAmount: transactionTotal,
      offerApplied: applyOffer,
      offer: offerValid
        ? { productId: xeroxProductId, buyQty, freeQty }
        : { productId: null, buyQty: 0, freeQty: 0 },
      xeroxSummary: {
        progress_before: progressPaidBefore,
        wallet_before: freeBalanceBefore,
        requested: xeroxRequested,
        paid: xeroxPaidTx,
        free_used: xeroxFreeUsedTx,
        free_earned: xeroxFreeEarnedTx,
        progress_after: runningProgress,
        wallet_after: runningFreeBal,
      },
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
    const [customerRows] = await query("SELECT id, name, mobile FROM customers WHERE mobile = ?", [
      mobile,
    ]);
    if (!customerRows.length) {
      return res.status(404).json({ message: "Customer not found" });
    }
    const customerId = customerRows[0].id;

    const [transactions] = await query(
      `SELECT id AS transactionId, total_amount AS totalAmount, created_at AS date
       FROM transactions
       WHERE customer_id = ?
       ORDER BY created_at DESC`,
      [customerId]
    );

    const [[xeroxOffer]] = await query(
      `SELECT p.id AS productId, o.buy_quantity, o.free_quantity
       FROM offers o
       JOIN products p ON p.id = o.product_id
       WHERE o.active = 1 AND LOWER(TRIM(p.name)) LIKE '%xerox%'
       ORDER BY o.id DESC
       LIMIT 1`
    );

    const offerProductId = xeroxOffer?.productId || null;
    const buyQty = Number(xeroxOffer?.buy_quantity || 0);
    const freeQty = Number(xeroxOffer?.free_quantity || 0);

    let [[reward]] = await query("SELECT * FROM customer_rewards WHERE customer_id = ?", [
      customerId,
    ]);

    if (!reward) {
      await query(
        `INSERT INTO customer_rewards (customer_id, total_xerox_pages, free_xerox_pages, pages_used)
         VALUES (?, 0, 0, 0)`,
        [customerId]
      );
      [[reward]] = await query("SELECT * FROM customer_rewards WHERE customer_id = ?", [
        customerId,
      ]);
    }

    const totalPrinted = Number(reward.total_xerox_pages || 0); // paid + free total
    const freeEarned = Number(reward.free_xerox_pages || 0);
    const freeUsed = Number(reward.pages_used || 0);

    const free_remaining = Math.max(freeEarned - freeUsed, 0);
    const paid_total = Math.max(totalPrinted - freeUsed, 0);

    const cycle_progress = buyQty > 0 ? paid_total % buyQty : 0;
    const cycle_count = buyQty > 0 ? Math.floor(paid_total / buyQty) : 0;
    const next_unlock_in = buyQty > 0 ? buyQty - cycle_progress : 0;

    res.json({
      customer: customerRows[0],
      transactions,
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

export default router;
