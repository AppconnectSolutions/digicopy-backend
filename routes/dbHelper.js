// dbHelper.js
import { pool } from "../db.js";

export async function query(sql, params = []) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    if (err.fatal) {
      console.error("Fatal MySQL error. Reconnecting...", err.message);
      // pool will handle reconnections automatically, just log for debugging
    } else {
      console.error("MySQL query error:", err.message);
    }
    throw err; // let the route catch it
  }
}
