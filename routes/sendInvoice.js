import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { customerId, mobile, invoiceImage, invoiceNo } = req.body;

    if (!customerId || !mobile || !invoiceImage || !invoiceNo) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // ✅ Use SAME folder: uploads/invoice
    const uploadDir = path.join(process.cwd(), "uploads", "invoice"); 
    fs.mkdirSync(uploadDir, { recursive: true });

    const fileName = `INV-${invoiceNo}.png`;
    const filePath = path.join(uploadDir, fileName);

    const base64Data = invoiceImage.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(filePath, base64Data, "base64");

    // ✅ Correct public base + correct route
    const BASE =
      process.env.BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:5000";

    const invoiceUrl = `${process.env.BASE_URL}/uploads/invoice/${fileName}`; 

    return res.json({
      success: true,
      invoiceUrl,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

export default router;
