"use strict";

/**
 * db.js — Neon Postgres persistence layer for Yobest_BYTR bot
 *
 * If DATABASE_URL is not set, every exported function becomes a no-op so the
 * bot runs exactly as before (in-memory only).  Set the env var to switch on
 * full persistence without changing any other behaviour.
 */

let pool = null;

try {
    if (process.env.DATABASE_URL) {
        const { Pool } = require("pg");
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            max: 5,
        });
        pool.on("error", (err) => console.error("Neon pool error:", err.message));
        console.log("✅ Neon Postgres pool initialised.");
    } else {
        console.warn("⚠️  DATABASE_URL not set — running in-memory only (no persistence).");
    }
} catch (e) {
    console.warn("⚠️  pg package not found or pool failed — running in-memory only.", e.message);
}

// ---- internals ----

function query(sql, params = []) {
    if (!pool) return Promise.resolve({ rows: [] });
    return pool.query(sql, params).catch((e) => {
        console.error("DB error:", e.message, "|", sql.slice(0, 80));
        return { rows: [] };
    });
}

// ---- public: is the DB actually live? ----

function ready() {
    return !!pool;
}

// ---- schema init (idempotent — call on ready) ----

async function initSchema() {
    if (!pool) return;
    const fs = require("fs");
    const path = require("path");
    try {
        const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
        await pool.query(sql);
        console.log("✅ Neon schema verified.");
    } catch (e) {
        console.error("Schema init error:", e.message);
    }
}

// ---- hydrate all in-memory state from DB on startup ----

async function loadAllState() {
    if (!pool) return {};
    const [settings, xp, warnings, cmds, rxRoles, tickets, scripts] = await Promise.all([
        query("SELECT * FROM guild_settings"),
        query("SELECT * FROM xp"),
        query("SELECT * FROM warnings ORDER BY ts ASC"),
        query("SELECT * FROM custom_commands"),
        query("SELECT * FROM reaction_roles"),
        query("SELECT channel_id FROM tickets WHERE status = 'open'"),
        query("SELECT script_id, title, lang, script FROM scripts"),
    ]);
    return {
        guildSettings:  settings.rows,
        xp:             xp.rows,
        warnings:       warnings.rows,
        customCommands: cmds.rows,
        reactionRoles:  rxRoles.rows,
        openTickets:    tickets.rows.map((r) => r.channel_id),
        scripts:        scripts.rows,
    };
}

// ---- guild settings ----

async function saveGuildSettings(guildId, s) {
    await query(
        `INSERT INTO guild_settings
            (guild_id, mod_role_id, auto_role_id, welcome_channel, goodbye_channel,
             modlog_channel, ticket_category, welcome_message, goodbye_message, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            mod_role_id      = EXCLUDED.mod_role_id,
            auto_role_id     = EXCLUDED.auto_role_id,
            welcome_channel  = EXCLUDED.welcome_channel,
            goodbye_channel  = EXCLUDED.goodbye_channel,
            modlog_channel   = EXCLUDED.modlog_channel,
            ticket_category  = EXCLUDED.ticket_category,
            welcome_message  = EXCLUDED.welcome_message,
            goodbye_message  = EXCLUDED.goodbye_message,
            updated_at       = NOW()`,
        [
            guildId,
            s.modRoleId        ?? null,
            s.autoRoleId       ?? null,
            s.welcomeChannelId ?? null,
            s.goodbyeChannelId ?? null,
            s.modlogChannelId  ?? null,
            s.ticketCategoryId ?? null,
            s.welcomeMessage   ?? null,
            s.goodbyeMessage   ?? null,
        ]
    );
}

// ---- XP ----

async function saveXP(userId, data, meta = {}) {
    await query(
        `INSERT INTO xp (user_id, username, avatar_url, xp, level, updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (user_id) DO UPDATE SET
            username   = COALESCE(EXCLUDED.username,   xp.username),
            avatar_url = COALESCE(EXCLUDED.avatar_url, xp.avatar_url),
            xp         = EXCLUDED.xp,
            level      = EXCLUDED.level,
            updated_at = NOW()`,
        [userId, meta.username ?? null, meta.avatarURL ?? null, data.xp, data.level]
    );
}

async function clearXP(userId) {
    await query("DELETE FROM xp WHERE user_id = $1", [userId]);
}

// ---- warnings ----

async function saveWarning(userId, guildId, reason, warnedBy) {
    await query(
        `INSERT INTO warnings (user_id, guild_id, reason, warned_by) VALUES ($1,$2,$3,$4)`,
        [userId, guildId ?? null, reason, warnedBy]
    );
}

async function clearWarnings(userId) {
    await query("DELETE FROM warnings WHERE user_id = $1", [userId]);
}

// ---- custom commands ----

async function setCustomCommand(guildId, trigger, response) {
    await query(
        `INSERT INTO custom_commands (guild_id, trigger, response) VALUES ($1,$2,$3)
         ON CONFLICT (guild_id, trigger) DO UPDATE SET response = EXCLUDED.response`,
        [guildId, trigger, response]
    );
}

async function removeCustomCommand(guildId, trigger) {
    await query("DELETE FROM custom_commands WHERE guild_id=$1 AND trigger=$2", [guildId, trigger]);
}

// ---- reaction roles ----

async function addReactionRole(guildId, msgId, emoji, roleId) {
    await query(
        `INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (guild_id, message_id, emoji) DO UPDATE SET role_id = EXCLUDED.role_id`,
        [guildId, msgId, emoji, roleId]
    );
}

// ---- tickets ----

async function openTicket(channelId, guildId, userId) {
    await query(
        `INSERT INTO tickets (channel_id, guild_id, user_id) VALUES ($1,$2,$3)
         ON CONFLICT (channel_id) DO UPDATE SET status='open', opened_at=NOW(), closed_at=NULL`,
        [channelId, guildId ?? null, userId ?? null]
    );
}

async function closeTicket(channelId) {
    await query(
        `UPDATE tickets SET status='closed', closed_at=NOW() WHERE channel_id=$1`,
        [channelId]
    );
}

// ---- scripts ----

async function saveScript(scriptId, guildId, channelId, title, lang, script) {
    await query(
        `INSERT INTO scripts (script_id, guild_id, channel_id, title, lang, script)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (script_id) DO UPDATE SET
            title=$4, lang=$5, script=$6`,
        [scriptId, guildId ?? null, channelId ?? null, title, lang, script]
    );
}

async function getScript(scriptId) {
    const { rows } = await query("SELECT * FROM scripts WHERE script_id=$1", [scriptId]);
    return rows[0] ?? null;
}

// ---- game catalog ----

async function addGame(title, description, playUrl, imageUrl, addedBy) {
    const { rows } = await query(
        `INSERT INTO games (title, description, play_url, image_url, added_by, status)
         VALUES ($1,$2,$3,$4,$5,'live')
         ON CONFLICT (title) DO UPDATE SET
            description=EXCLUDED.description,
            play_url=EXCLUDED.play_url,
            image_url=EXCLUDED.image_url,
            status='live',
            added_by=EXCLUDED.added_by
         RETURNING id`,
        [title, description ?? null, playUrl ?? null, imageUrl ?? null, addedBy ?? null]
    );
    return rows[0]?.id ?? null;
}

async function removeGame(title) {
    const { rows } = await query(
        `UPDATE games SET status='hidden' WHERE title=$1 RETURNING id`,
        [title]
    );
    return rows.length > 0;
}

async function listGames() {
    const { rows } = await query(
        `SELECT title, description, play_url, image_url, status FROM games ORDER BY created_at DESC`
    );
    return rows;
}

// ---- guild stats snapshot (for dashboard + sparkline) ----

async function upsertGuildSnapshot(guild) {
    const iconURL = guild.iconURL?.({ dynamic: true }) ?? null;
    await query(
        `INSERT INTO guilds (guild_id, name, icon_url, member_count, boost_level, boost_count, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (guild_id) DO UPDATE SET
            name=EXCLUDED.name, icon_url=EXCLUDED.icon_url,
            member_count=EXCLUDED.member_count,
            boost_level=EXCLUDED.boost_level, boost_count=EXCLUDED.boost_count,
            updated_at=NOW()`,
        [
            guild.id,
            guild.name,
            iconURL,
            guild.memberCount ?? 0,
            guild.premiumTier ?? 0,
            guild.premiumSubscriptionCount ?? 0,
        ]
    );
    // append to history for sparkline (one row every snapshot cycle)
    await query(
        `INSERT INTO guild_stats_history (guild_id, member_count) VALUES ($1,$2)`,
        [guild.id, guild.memberCount ?? 0]
    );
}

module.exports = {
    ready,
    initSchema,
    loadAllState,
    saveGuildSettings,
    saveXP, clearXP,
    saveWarning, clearWarnings,
    setCustomCommand, removeCustomCommand,
    addReactionRole,
    openTicket, closeTicket,
    saveScript, getScript,
    addGame, removeGame, listGames,
    upsertGuildSnapshot,
};
