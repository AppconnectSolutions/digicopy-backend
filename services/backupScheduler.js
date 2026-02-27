import cron from "node-cron";
import mysql from "mysql2/promise";
import { getSheetsClient, ensureTab, replaceTabValuesChunked } from "./backupService.js";

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

let watcherTask = null;

async function getSetting(key) {
  const [rows] = await pool.query("SELECT v FROM app_settings WHERE k=?", [key]);
  return rows?.[0]?.v ?? null;
}

async function setSetting(key, value) {
  await pool.query(
    "INSERT INTO app_settings (k,v) VALUES (?,?) ON DUPLICATE KEY UPDATE v=VALUES(v)",
    [key, String(value ?? "")]
  );
}

function safeTableName(name) {
  return /^[a-zA-Z0-9_]+$/.test(name);
}

function addDaysIso(fromIso, days) {
  const d = fromIso ? new Date(fromIso) : new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function addMinutesIso(fromIso, minutes) {
  const d = fromIso ? new Date(fromIso) : new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

async function getTablesToBackup() {
  const envVal = (process.env.BACKUP_TABLES || "").trim();
  if (!envVal) return ["customers", "products", "transactions"];

  if (envVal.toUpperCase() === "ALL") {
    const [rows] = await pool.query("SHOW FULL TABLES WHERE Table_type='BASE TABLE'");
    return rows.map((r) => r[Object.keys(r)[0]]);
  }

  return envVal.split(",").map((t) => t.trim()).filter(Boolean);
}

/** ✅ Runs backup and replaces Google Sheet data */
async function backupDatabaseToGoogleSheet() {
  const [lockRows] = await pool.query("SELECT GET_LOCK('gsheet_backup_lock', 0) AS got");
  if (lockRows?.[0]?.got !== 1) {
    console.log("Backup skipped: lock not acquired");
    return;
  }

  try {
    const spreadsheetId = process.env.SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error("SPREADSHEET_ID missing in .env");

    const sheets = await getSheetsClient();
    const tables = await getTablesToBackup();

    console.log("Starting backup for tables:", tables);

    await ensureTab(sheets, spreadsheetId, "BACKUP_LOG");
    await replaceTabValuesChunked(sheets, spreadsheetId, "BACKUP_LOG", [
      ["Last Backup (IST)"],
      [new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })],
    ]);

    for (const table of tables) {
      if (!safeTableName(table)) continue;

      const [rows] = await pool.query(`SELECT * FROM \`${table}\``);
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const values = [headers];

      for (const r of rows) values.push(headers.map((h) => r[h]));

      await ensureTab(sheets, spreadsheetId, table);
      await replaceTabValuesChunked(sheets, spreadsheetId, table, values, 400);

      console.log(`Backed up table ${table}, rows: ${rows.length}`);
    }
  } catch (e) {
    console.error("Backup failed:", e.message, e.stack);
    await setSetting("last_backup_error", e.message);
    throw e;
  } finally {
    await pool.query("SELECT RELEASE_LOCK('gsheet_backup_lock')");
  }
}

/** ✅ Scheduler: checks due backups every 5 minutes */
async function startWatcher() {
  if (watcherTask) {
    watcherTask.stop();
    watcherTask = null;
  }

  watcherTask = cron.schedule(
    "*/5 * * * *", // every 5 minutes
    async () => {
      try {
        const enabled = (await getSetting("backup_enabled")) === "true";
        const nextIso = await getSetting("next_backup_at");
        const now = new Date();

        console.log("Watcher tick:", now.toISOString(), "enabled:", enabled, "next:", nextIso);

        if (!enabled || !nextIso) return;

        const next = new Date(nextIso);

        if (now >= next) {
          console.log("Triggering backup at", now.toISOString());

          await backupDatabaseToGoogleSheet();

          const nowIso = new Date().toISOString();
          await setSetting("last_backup_at", nowIso);
          await setSetting("next_backup_at", addDaysIso(nowIso, 7));
        }
      } catch (e) {
        console.error("Backup watcher failed:", e.message, e.stack);
        await setSetting("last_backup_error", e.message);
      }
    },
    { timezone: "Asia/Kolkata" }
  );
}

/** Called from server.js on startup */
export async function initBackupScheduler() {
  await startWatcher();
}

/** For UI status */
export async function getBackupStatus() {
  const enabled = (await getSetting("backup_enabled")) === "true";
  const last = await getSetting("last_backup_at");
  const next = await getSetting("next_backup_at");
  const error = await getSetting("last_backup_error");

  return {
    enabled,
    last_backup_at: last || null,
    next_backup_at: next || null,
    last_backup_error: error || null,
    last_backup_successful: !!last && !error,
  };
}

/** Toggle ON/OFF */
export async function setBackupEnabled(enabled) {
  await setSetting("backup_enabled", enabled ? "true" : "false");

  if (!enabled) {
    await setSetting("next_backup_at", "");
    return { ok: true, enabled: false };
  }

  await backupDatabaseToGoogleSheet();

  const nowIso = new Date().toISOString();
  await setSetting("last_backup_at", nowIso);
  await setSetting("next_backup_at", addMinutesIso(nowIso, 2));
return { ok: true, enabled: true, next_backup_at: addMinutesIso(nowIso, 2) };
}

/** manual backup endpoint */
export async function runBackupNow() {
  await backupDatabaseToGoogleSheet();
  const nowIso = new Date().toISOString();
  await setSetting("last_backup_at", nowIso);
  await setSetting("next_backup_at", addDaysIso(nowIso, 7)); // weekly cycle

}
