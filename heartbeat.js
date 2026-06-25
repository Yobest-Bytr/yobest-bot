"use strict";
// Writes a fresh timestamp to Neon every 30s.
// Also pings WEBSITE_URL/api/heartbeat with HEARTBEAT_SECRET so the site
// can show Online/Offline even when it reads from its own API rather than
// querying Neon directly.

const { neon } = require("@neondatabase/serverless");

const sql            = process.env.DATABASE_URL    ? neon(process.env.DATABASE_URL) : null;
const WEBSITE_URL    = (process.env.WEBSITE_URL    || "").replace(/\/$/, "");
const HEART_SECRET   = process.env.HEARTBEAT_SECRET || "";

async function pingWebsite() {
    if (!WEBSITE_URL) return;
    try {
        await fetch(`${WEBSITE_URL}/api/heartbeat`, {
            method:  "POST",
            headers: {
                "Content-Type":       "application/json",
                "x-heartbeat-secret": HEART_SECRET,
            },
            body: JSON.stringify({ ts: Date.now() }),
            signal: AbortSignal.timeout(8_000),
        });
    } catch (e) {
        console.warn("[heartbeat] website ping failed:", e.message);
    }
}

async function beat() {
    if (!sql) {
        console.warn("[heartbeat] DATABASE_URL not set — skipping DB write.");
    } else {
        try {
            await sql`CREATE TABLE IF NOT EXISTS bot_heartbeat (ts TIMESTAMPTZ NOT NULL)`;
            await sql`DELETE FROM bot_heartbeat`;
            await sql`INSERT INTO bot_heartbeat (ts) VALUES (NOW())`;
        } catch (e) {
            console.error("[heartbeat] DB write failed:", e.message);
        }
    }
    await pingWebsite();
}

beat();                      // write one immediately on startup
setInterval(beat, 30_000);   // then every 30s

module.exports = {};
