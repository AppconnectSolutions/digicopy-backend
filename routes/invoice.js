// routes/invoice.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

const storage = multer.diskStorage({
    
  destination: (req, file, cb) => {
    const dir = path.join(process.cwd(), "uploads/invoice");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `invoice-${Date.now()}.png`);
  },
});

const upload = multer({ storage });

router.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const filePath = `/uploads/invoice/${req.file.filename}`;
  const publicUrl = `${process.env.BASE_URL || "http://localhost:5000"}${filePath}`;
  res.json({ url: publicUrl });
});

export default router;
