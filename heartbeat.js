"use strict";

/**
 * heartbeat.js
 * Pings the website /api/bot-status every 30 seconds so the site can
 * distinguish "bot truly online" from "bot offline with stale DB data".
 *
 * Usage — add ONE line at the top of index.js (after const db = require("./db")):
 *   require("./heartbeat");
 */

const INTERVAL_MS = 30_000;
const URL         = process.env.WEBSITE_URL     || "https://yobest-bot-system.vercel.app";
const SECRET      = process.env.HEARTBEAT_SECRET || "";

async function ping() {
  try {
    const res = await fetch(`${URL}/api/bot-status`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-heartbeat-secret": SECRET },
      body:    JSON.stringify({ ts: Date.now() }),
      signal:  AbortSignal.timeout(8_000),
    });
    if (!res.ok) console.warn(`[heartbeat] HTTP ${res.status}`);
  } catch (e) {
    console.warn("[heartbeat] ping failed:", e.message);
  }
}

ping();
setInterval(ping, INTERVAL_MS);
console.log(`[heartbeat] pinging ${URL} every ${INTERVAL_MS / 1000}s`);
