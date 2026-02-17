import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import rolesRoutes from "./routes/roles.js";

import customerRoutes from "./routes/customer.js";
import adminRoutes from "./routes/admin.js";
import productRoutes from "./routes/product.js";
import transactionRoutes from "./routes/transaction.js";
import offersRouter from "./routes/offers.js";
import sendInvoiceRouter from "./routes/sendInvoice.js";
import invoicesRouter from "./routes/invoice.js";
import promotionRoutes from "./routes/promotion.js";
import dashboardRouter from "./routes/dashboard.js";
import backupRoutes from "./routes/backup.js";
import { initBackupScheduler } from "./services/backupScheduler.js";

dotenv.config();

const app = express();

// ✅ Logging
app.use((req, res, next) => {
  console.log("Incoming request:", req.method, req.url);
  next();
});

app.use(cors());
app.use(express.json());

// ✅ IMPORTANT: invoice folder must exist + must be absolute
const INVOICE_DIR = path.join(process.cwd(), "uploads", "invoice");
fs.mkdirSync(INVOICE_DIR, { recursive: true });

console.log("✅ Serving invoice images from:", INVOICE_DIR);

// ✅ Serve invoice images (absolute + no fallthrough)
app.use(
  "/uploads/invoice",
  express.static(INVOICE_DIR, { fallthrough: false })
);

// ✅ OPTIONAL: debug route to confirm files exist
app.get("/debug/invoices", (req, res) => {
  try {
    const files = fs.readdirSync(INVOICE_DIR);
    res.json({
      dir: INVOICE_DIR,
      count: files.length,
      last10: files.slice(-10),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ✅ Mount routes
app.use("/api/customers", customerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/offers", offersRouter);
app.use("/api/send-invoice", sendInvoiceRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/promotions", promotionRoutes);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/roles", rolesRoutes);
app.use("/api/backup", backupRoutes);


const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => res.send("Backend is live and connected to MySQL!"));

initBackupScheduler().catch((e) => {
  console.error("❌ Backup scheduler init failed:", e);
});

// ✅ Catch-all (kept, but now static 404 won't land here)
app.use((req, res) => {
  res.status(404).send(`No route matched: ${req.method} ${req.url}`);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
