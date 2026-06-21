-- Yobest Studio · Neon schema v2
-- Safe to re-run — every statement is idempotent.

-- ── Existing tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY, mod_role_id TEXT, auto_role_id TEXT,
  welcome_channel TEXT, goodbye_channel TEXT, modlog_channel TEXT,
  ticket_category TEXT, welcome_message TEXT, goodbye_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS xp (
  user_id TEXT PRIMARY KEY, username TEXT, avatar_url TEXT,
  xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warnings (
  id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT,
  reason TEXT NOT NULL, warned_by TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS warnings_user_idx ON warnings(user_id);

CREATE TABLE IF NOT EXISTS custom_commands (
  guild_id TEXT NOT NULL, trigger TEXT NOT NULL, response TEXT NOT NULL,
  PRIMARY KEY (guild_id, trigger)
);

CREATE TABLE IF NOT EXISTS reaction_roles (
  guild_id TEXT NOT NULL, message_id TEXT NOT NULL, emoji TEXT NOT NULL,
  role_id TEXT NOT NULL, PRIMARY KEY (guild_id, message_id, emoji)
);

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY, guild_id TEXT, user_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS scripts (
  script_id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT,
  title TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'lua', script TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS games (
  id BIGSERIAL PRIMARY KEY, title TEXT NOT NULL UNIQUE,
  description TEXT, play_url TEXT, image_url TEXT,
  status TEXT NOT NULL DEFAULT 'live', added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY, name TEXT, icon_url TEXT,
  member_count INTEGER NOT NULL DEFAULT 0,
  boost_level INTEGER NOT NULL DEFAULT 0, boost_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guild_stats_history (
  id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL,
  member_count INTEGER NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS guild_history_idx ON guild_stats_history(guild_id, captured_at DESC);

-- ── New v2 tables ──────────────────────────────────────────────────────────────

-- Bot heartbeat — site checks MAX(ts) to determine true online status
CREATE TABLE IF NOT EXISTS bot_heartbeat (
  id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Live config store — website writes, bot polls every 60s
CREATE TABLE IF NOT EXISTS bot_config (
  key TEXT PRIMARY KEY, value TEXT NOT NULL,
  updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bot_config (key,value,updated_by) VALUES
  ('ai_system_prompt','You are Yobest_BYTR, a friendly Discord bot for Yobest Studio. Help with Roblox game development, Lua scripting, and community questions.','system'),
  ('ai_enabled','true','system'),
  ('ai_model','openai/gpt-4o-mini','system'),
  ('xp_enabled','true','system'),
  ('automod_enabled','true','system'),
  ('welcome_enabled','true','system')
ON CONFLICT (key) DO NOTHING;

-- Web commands queue — website queues, bot polls every 15s and executes
CREATE TABLE IF NOT EXISTS web_commands (
  id BIGSERIAL PRIMARY KEY, guild_id TEXT NOT NULL,
  command TEXT NOT NULL, payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS web_commands_pending ON web_commands(status,created_at) WHERE status='pending';
