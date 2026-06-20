-- Yobest Studio · Neon Postgres schema
-- Safe to run more than once — every statement is idempotent.

-- Guild settings (welcome msg, mod role, etc.)
CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id          TEXT PRIMARY KEY,
    mod_role_id       TEXT,
    auto_role_id      TEXT,
    welcome_channel   TEXT,
    goodbye_channel   TEXT,
    modlog_channel    TEXT,
    ticket_category   TEXT,
    welcome_message   TEXT,
    goodbye_message   TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Per-user XP (global across guilds, matching the bot's current design)
CREATE TABLE IF NOT EXISTS xp (
    user_id    TEXT PRIMARY KEY,
    username   TEXT,
    avatar_url TEXT,
    xp         INTEGER NOT NULL DEFAULT 0,
    level      INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Warnings
CREATE TABLE IF NOT EXISTS warnings (
    id         BIGSERIAL PRIMARY KEY,
    user_id    TEXT NOT NULL,
    guild_id   TEXT,
    reason     TEXT NOT NULL,
    warned_by  TEXT NOT NULL,
    ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS warnings_user_idx ON warnings (user_id);

-- Custom commands
CREATE TABLE IF NOT EXISTS custom_commands (
    guild_id  TEXT NOT NULL,
    trigger   TEXT NOT NULL,
    response  TEXT NOT NULL,
    PRIMARY KEY (guild_id, trigger)
);

-- Reaction roles
CREATE TABLE IF NOT EXISTS reaction_roles (
    guild_id   TEXT NOT NULL,
    message_id TEXT NOT NULL,
    emoji      TEXT NOT NULL,
    role_id    TEXT NOT NULL,
    PRIMARY KEY (guild_id, message_id, emoji)
);

-- Open ticket channels
CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT,
    user_id    TEXT,
    status     TEXT NOT NULL DEFAULT 'open',
    opened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at  TIMESTAMPTZ
);

-- Script store (survives bot restarts so View/Copy/Download buttons keep working)
CREATE TABLE IF NOT EXISTS scripts (
    script_id  TEXT PRIMARY KEY,
    guild_id   TEXT,
    channel_id TEXT,
    title      TEXT NOT NULL,
    lang       TEXT NOT NULL DEFAULT 'lua',
    script     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Game catalog (populated via /addgame, read by the website)
CREATE TABLE IF NOT EXISTS games (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL UNIQUE,
    description TEXT,
    play_url    TEXT,
    image_url   TEXT,
    status      TEXT NOT NULL DEFAULT 'live',
    added_by    TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Guild snapshot (written every 5 min by the bot, read by the website dashboard)
CREATE TABLE IF NOT EXISTS guilds (
    guild_id     TEXT PRIMARY KEY,
    name         TEXT,
    icon_url     TEXT,
    member_count INTEGER NOT NULL DEFAULT 0,
    boost_level  INTEGER NOT NULL DEFAULT 0,
    boost_count  INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Growth history for sparkline charts on the dashboard
CREATE TABLE IF NOT EXISTS guild_stats_history (
    id           BIGSERIAL PRIMARY KEY,
    guild_id     TEXT NOT NULL,
    member_count INTEGER NOT NULL,
    captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS guild_history_idx ON guild_stats_history (guild_id, captured_at DESC);
