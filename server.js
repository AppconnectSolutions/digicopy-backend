import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import customerRoutes from "./routes/customer.js";
import adminRoutes from "./routes/admin.js";
import productRoutes from "./routes/product.js";
import transactionRoutes from "./routes/transaction.js";
import offersRouter from "./routes/offers.js";
import sendInvoiceRouter from "./routes/sendInvoice.js";
import invoicesRouter from "./routes/invoice.js";



dotenv.config();

const app = express();
app.use((req, res, next) => { console.log("Incoming request:", req.method, req.url); next(); });
app.use(cors());
app.use(express.json());

// ✅ Serve uploaded invoice images
// ✅ Serve uploaded invoice images
app.use("/uploads/invoice", express.static("uploads/invoice"));



// ✅ Mount your routes
app.use("/api/customers", customerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/offers", offersRouter);
app.use("/api/send-invoice", sendInvoiceRouter);
app.use("/api/invoices", invoicesRouter);

const PORT = process.env.PORT || 5000;
app.get("/", (req, res) => {
  res.send("Backend is live and connected to MySQL!");
});

// ✅ Catch-all for unmatched routes
app.use((req, res) => {
  res.status(404).send(`No route matched: ${req.method} ${req.url}`);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
