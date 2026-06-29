"use strict";
/**
 * db.js — Neon Postgres layer for Yobest_BYTR bot (v3)
 *
 * Degrades gracefully when DATABASE_URL is not set — every function
 * returns a safe empty value instead of throwing.
 */

let pool = null;

// We set `ssl` explicitly below, so strip any sslmode= query param from the
// connection string — otherwise pg-connection-string parses it too and logs
// a noisy "SSL modes are aliases for verify-full" deprecation warning.
function stripSslMode(connStr) {
  try {
    const u = new URL(connStr);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return connStr;
  }
}

try {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: stripSslMode(process.env.DATABASE_URL),
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
    pool.on("error", (e) => console.error("[db] pool error:", e.message));
    console.log("✅ [db] Neon pool ready");
  } else {
    console.warn("⚠️  [db] DATABASE_URL not set — running in-memory only");
  }
} catch (e) {
  console.warn("⚠️  [db] pg unavailable:", e.message);
}

function q(sql, params = []) {
  if (!pool) return Promise.resolve({ rows: [] });
  return pool.query(sql, params).catch((e) => {
    console.error("[db]", e.message, "|", sql.slice(0, 80));
    return { rows: [] };
  });
}

const ready = () => !!pool;

// ── Schema init ────────────────────────────────────────────────────────────────
async function initSchema() {
  if (!pool) return;
  try {
    const fs   = require("fs");
    const path = require("path");
    const sql  = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("✅ [db] schema verified");
  } catch (e) { console.error("[db] schema init:", e.message); }
}

// ── Hydrate in-memory state on startup ────────────────────────────────────────
async function loadAllState() {
  if (!pool) return {};
  const [settings, xp, warnings, cmds, rxRoles, tickets, scripts, config, modRoles, cmdPerms] = await Promise.all([
    q("SELECT * FROM guild_settings"),
    q("SELECT * FROM xp"),
    q("SELECT * FROM warnings ORDER BY ts ASC"),
    q("SELECT * FROM custom_commands"),
    q("SELECT * FROM reaction_roles"),
    q("SELECT channel_id FROM tickets WHERE status='open'"),
    q("SELECT script_id,title,lang,script FROM scripts"),
    q("SELECT key,value FROM bot_config"),
    q("SELECT guild_id,role_id FROM guild_mod_roles"),
    q("SELECT guild_id,command,min_level FROM command_permissions"),
  ]);
  return {
    guildSettings:  settings.rows,
    xp:             xp.rows,
    warnings:       warnings.rows,
    customCommands: cmds.rows,
    reactionRoles:  rxRoles.rows,
    openTickets:    tickets.rows.map((r) => r.channel_id),
    scripts:        scripts.rows,
    config:         Object.fromEntries(config.rows.map((r) => [r.key, r.value])),
    modRoles:       modRoles.rows,
    commandPerms:   cmdPerms.rows,
  };
}

// ── Guild settings ─────────────────────────────────────────────────────────────
async function saveGuildSettings(guildId, s) {
  await q(`INSERT INTO guild_settings
    (guild_id,mod_role_id,auto_role_id,welcome_channel,goodbye_channel,
     modlog_channel,ticket_category,welcome_message,goodbye_message,
     ticket_log_channel,ticket_panel_channel,ticket_name_prefix,roblox_updates_channel,
     game_announce_channel,updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
   ON CONFLICT (guild_id) DO UPDATE SET
     mod_role_id=$2,auto_role_id=$3,welcome_channel=$4,goodbye_channel=$5,
     modlog_channel=$6,ticket_category=$7,welcome_message=$8,goodbye_message=$9,
     ticket_log_channel=$10,ticket_panel_channel=$11,ticket_name_prefix=$12,roblox_updates_channel=$13,
     game_announce_channel=$14,updated_at=NOW()`,
  [guildId,s.modRoleId??null,s.autoRoleId??null,s.welcomeChannelId??null,
   s.goodbyeChannelId??null,s.modlogChannelId??null,s.ticketCategoryId??null,
   s.welcomeMessage??null,s.goodbyeMessage??null,
   s.ticketLogChannelId??null,s.ticketPanelChannelId??null,s.ticketNamePrefix??null,s.robloxUpdatesChannelId??null,
   s.gameAnnounceChannelId??null]);
}

// ── Mod roles (additional, beyond the single legacy mod_role_id) ──────────────
async function addModRole(guildId, roleId) {
  await q(`INSERT INTO guild_mod_roles (guild_id,role_id) VALUES ($1,$2)
   ON CONFLICT (guild_id,role_id) DO NOTHING`, [guildId, roleId]);
}
async function removeModRole(guildId, roleId) {
  await q("DELETE FROM guild_mod_roles WHERE guild_id=$1 AND role_id=$2", [guildId, roleId]);
}

// ── Per-command permission overrides ──────────────────────────────────────────
async function setCommandPermission(guildId, command, minLevel) {
  await q(`INSERT INTO command_permissions (guild_id,command,min_level) VALUES ($1,$2,$3)
   ON CONFLICT (guild_id,command) DO UPDATE SET min_level=$3`, [guildId, command, minLevel]);
}
async function removeCommandPermission(guildId, command) {
  await q("DELETE FROM command_permissions WHERE guild_id=$1 AND command=$2", [guildId, command]);
}

// ── XP ─────────────────────────────────────────────────────────────────────────
async function saveXP(userId, data, meta = {}) {
  await q(`INSERT INTO xp (user_id,username,avatar_url,xp,level,updated_at)
   VALUES ($1,$2,$3,$4,$5,NOW())
   ON CONFLICT (user_id) DO UPDATE SET
     username=COALESCE($2,xp.username),avatar_url=COALESCE($3,xp.avatar_url),
     xp=$4,level=$5,updated_at=NOW()`,
  [userId,meta.username??null,meta.avatarURL??null,data.xp,data.level]);
}
async function clearXP(userId) {
  await q("DELETE FROM xp WHERE user_id=$1", [userId]);
}

// ── Warnings ───────────────────────────────────────────────────────────────────
async function saveWarning(userId, guildId, reason, warnedBy) {
  await q("INSERT INTO warnings (user_id,guild_id,reason,warned_by) VALUES ($1,$2,$3,$4)",
    [userId,guildId??null,reason,warnedBy]);
}
async function clearWarnings(userId) {
  await q("DELETE FROM warnings WHERE user_id=$1", [userId]);
}

// ── Custom commands ────────────────────────────────────────────────────────────
async function setCustomCommand(guildId, trigger, response) {
  await q(`INSERT INTO custom_commands (guild_id,trigger,response) VALUES ($1,$2,$3)
   ON CONFLICT (guild_id,trigger) DO UPDATE SET response=$3`, [guildId,trigger,response]);
}
async function removeCustomCommand(guildId, trigger) {
  await q("DELETE FROM custom_commands WHERE guild_id=$1 AND trigger=$2", [guildId,trigger]);
}

// ── Reaction roles ─────────────────────────────────────────────────────────────
async function addReactionRole(guildId, msgId, emoji, roleId) {
  await q(`INSERT INTO reaction_roles (guild_id,message_id,emoji,role_id) VALUES ($1,$2,$3,$4)
   ON CONFLICT (guild_id,message_id,emoji) DO UPDATE SET role_id=$4`,
  [guildId,msgId,emoji,roleId]);
}

// ── Tickets ────────────────────────────────────────────────────────────────────
async function openTicket(channelId, guildId, userId) {
  await q(`INSERT INTO tickets (channel_id,guild_id,user_id) VALUES ($1,$2,$3)
   ON CONFLICT (channel_id) DO UPDATE SET status='open',opened_at=NOW(),closed_at=NULL`,
  [channelId,guildId??null,userId??null]);
}
async function closeTicket(channelId) {
  await q("UPDATE tickets SET status='closed',closed_at=NOW() WHERE channel_id=$1", [channelId]);
}

// ── Scripts ────────────────────────────────────────────────────────────────────
async function saveScript(scriptId, guildId, channelId, title, lang, script) {
  await q(`INSERT INTO scripts (script_id,guild_id,channel_id,title,lang,script)
   VALUES ($1,$2,$3,$4,$5,$6)
   ON CONFLICT (script_id) DO UPDATE SET title=$4,lang=$5,script=$6`,
  [scriptId,guildId??null,channelId??null,title,lang,script]);
}
async function getScript(scriptId) {
  const { rows } = await q("SELECT * FROM scripts WHERE script_id=$1", [scriptId]);
  return rows[0] ?? null;
}

// ── Games ──────────────────────────────────────────────────────────────────────
async function addGame(title, description, playUrl, imageUrl, addedBy) {
  const { rows } = await q(`INSERT INTO games (title,description,play_url,image_url,added_by,status)
   VALUES ($1,$2,$3,$4,$5,'live')
   ON CONFLICT (title) DO UPDATE SET
     description=$2,play_url=$3,image_url=$4,status='live',added_by=$5
   RETURNING id, (xmax = 0) AS inserted`,
  [title,description??null,playUrl??null,imageUrl??null,addedBy??null]);
  if (!rows[0]) return null;
  return { id: rows[0].id, isNew: !!rows[0].inserted };
}
async function removeGame(title) {
  const { rows } = await q("UPDATE games SET status='hidden' WHERE title=$1 RETURNING id", [title]);
  return rows.length > 0;
}
async function listGames() {
  const { rows } = await q("SELECT title,description,play_url,image_url,status FROM games ORDER BY created_at DESC");
  return rows;
}
async function getGame(title) {
  const { rows } = await q("SELECT * FROM games WHERE title=$1", [title]);
  return rows[0] ?? null;
}
async function searchGames(query) {
  const { rows } = await q(
    "SELECT * FROM games WHERE status='live' AND (title ILIKE $1 OR description ILIKE $1) ORDER BY created_at DESC LIMIT 25",
    [`%${query}%`]
  );
  return rows;
}

// ── Guild snapshot ─────────────────────────────────────────────────────────────
async function upsertGuildSnapshot(guild) {
  const icon = guild.iconURL?.({ dynamic: true }) ?? null;
  await q(`INSERT INTO guilds (guild_id,name,icon_url,member_count,boost_level,boost_count,updated_at)
   VALUES ($1,$2,$3,$4,$5,$6,NOW())
   ON CONFLICT (guild_id) DO UPDATE SET
     name=$2,icon_url=$3,member_count=$4,boost_level=$5,boost_count=$6,updated_at=NOW()`,
  [guild.id,guild.name,icon,guild.memberCount??0,guild.premiumTier??0,guild.premiumSubscriptionCount??0]);
  await q("INSERT INTO guild_stats_history (guild_id,member_count) VALUES ($1,$2)",
    [guild.id, guild.memberCount??0]);
}

// ── Heartbeat (v2) ─────────────────────────────────────────────────────────────
async function writeHeartbeat() {
  await q("INSERT INTO bot_heartbeat (ts) VALUES (NOW())");
  await q("DELETE FROM bot_heartbeat WHERE id NOT IN (SELECT id FROM bot_heartbeat ORDER BY ts DESC LIMIT 20)");
}

// ── Bot config (v2) ────────────────────────────────────────────────────────────
async function getConfig(key) {
  const { rows } = await q("SELECT value FROM bot_config WHERE key=$1", [key]);
  return rows[0]?.value ?? null;
}
async function setConfig(key, value, updatedBy = "bot") {
  await q(`INSERT INTO bot_config (key,value,updated_by,updated_at) VALUES ($1,$2,$3,NOW())
   ON CONFLICT (key) DO UPDATE SET value=$2,updated_by=$3,updated_at=NOW()`,
  [key, value, updatedBy]);
}
async function getAllConfig() {
  const { rows } = await q("SELECT key,value,updated_by,updated_at FROM bot_config ORDER BY key");
  return rows;
}

// ── Web commands (v2) ──────────────────────────────────────────────────────────
async function pollWebCommands() {
  const { rows } = await q(
    "SELECT id,guild_id,command,payload FROM web_commands WHERE status='pending' ORDER BY created_at ASC LIMIT 10");
  return rows;
}
async function ackWebCommand(id, status, result = null) {
  await q("UPDATE web_commands SET status=$1,result=$2,executed_at=NOW() WHERE id=$3",
    [status, result, id]);
}

module.exports = {
  ready, initSchema, loadAllState,
  saveGuildSettings,
  addModRole, removeModRole,
  setCommandPermission, removeCommandPermission,
  saveXP, clearXP,
  saveWarning, clearWarnings,
  setCustomCommand, removeCustomCommand,
  addReactionRole,
  openTicket, closeTicket,
  saveScript, getScript,
  addGame, removeGame, listGames, getGame, searchGames,
  upsertGuildSnapshot,
  writeHeartbeat,
  getConfig, setConfig, getAllConfig,
  pollWebCommands, ackWebCommand,
};
