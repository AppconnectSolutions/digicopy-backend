import express from "express";

const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;

  // Hardcoded credentials
  const adminEmail = "admin@gmail.com";
  const adminPassword = "admin";

  if (email === adminEmail && password === adminPassword) {
    return res.json({
      message: "Login successful",
      admin: { id: 1, email: adminEmail, role: "owner" },
    });
  } else {
    return res.status(401).json({ message: "Invalid email or password" });
  }
});

export default router;
