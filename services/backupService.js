import fs from "fs";
import { google } from "googleapis";

export async function getSheetsClient() {
  const jsonPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonPath) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing in .env");

  const creds = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function ensureTab(sheets, spreadsheetId, tabName) {
  const ss = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = ss.data.sheets?.some((s) => s.properties?.title === tabName);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
}

export async function replaceTabValuesChunked(sheets, spreadsheetId, tabName, values, chunkSize = 500) {
  // Replace = clear + write fresh
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${tabName}!A:ZZZ`,
  });

  if (!values || values.length === 0) return;

  let startRow = 1;
  for (let i = 0; i < values.length; i += chunkSize) {
    const chunk = values.slice(i, i + chunkSize);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A${startRow}`,
      valueInputOption: "RAW",
      requestBody: { values: chunk },
    });

    startRow += chunk.length;
  }
}
