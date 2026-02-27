import bcrypt from "bcryptjs";
import { query } from "./routes/dbHelper.js";

const email = "hr@appconnectsolutions.com";
const newPassword = "admin"; // change this

(async () => {
  const hash = await bcrypt.hash(newPassword, 10);

  await query(
    `UPDATE admins SET password_hash = ? WHERE email = ?`,
    [hash, email]
  );

  console.log("✅ Password updated successfully");
  process.exit(0);
})();
