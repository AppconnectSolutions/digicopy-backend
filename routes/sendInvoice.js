import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { customerId, mobile, invoiceImage, invoiceNo } = req.body;
    console.log("POST /api/invoices hit", { customerId, invoiceNo });
    console.log("Invoice Base64 length:", invoiceImage?.length);

    if (!customerId || !mobile || !invoiceImage || !invoiceNo) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Ensure folder exists (absolute path)
    const uploadDir = path.join(process.cwd(), "uploads", "invoices");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Save image
    const fileName = `INV-${invoiceNo}.png`;
    const filePath = path.join(uploadDir, fileName);
    const base64Data = invoiceImage.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync(filePath, base64Data, "base64");

    const invoiceUrl = `${process.env.BASE_URL}/invoices/${fileName}`;
    console.log("Invoice saved for:", mobile, "at", filePath);

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
