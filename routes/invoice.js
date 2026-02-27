import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// ✅ ALWAYS use uploads/invoice (same everywhere)
const INVOICE_DIR = path.join(process.cwd(), "uploads", "invoice");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(INVOICE_DIR, { recursive: true });
    cb(null, INVOICE_DIR);
  },
  filename: (req, file, cb) => {
    cb(null, `invoice-${Date.now()}.png`);
  },
});

const upload = multer({ storage });

router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  // ✅ this must match server static route
  const filePath = `/uploads/invoice/${req.file.filename}`;

  // ✅ important: BASE_URL must be like http://localhost:5000 or https://api.digicopy.in
  const baseUrl = (process.env.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
  const publicUrl = `${baseUrl}${filePath}`;

  return res.json({ url: publicUrl, filePath });
});

export default router;
