"use strict";
// Writes a fresh timestamp to Neon every 30s.
// The website reads this same table (lib/db.js -> isBotOnline()) to show Online/Offline.

const { neon } = require("@neondatabase/serverless");

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

async function beat() {
  if (!sql) {
    console.warn("[heartbeat] DATABASE_URL not set — skipping.");
    return;
  }
  try {
    await sql`CREATE TABLE IF NOT EXISTS bot_heartbeat (ts TIMESTAMPTZ NOT NULL)`;
    await sql`DELETE FROM bot_heartbeat`;
    await sql`INSERT INTO bot_heartbeat (ts) VALUES (NOW())`;
  } catch (e) {
    console.error("[heartbeat] write failed:", e.message);
  }
}

beat();                     // write one immediately on startup
setInterval(beat, 30_000);   // then every 30s

module.exports = {};
