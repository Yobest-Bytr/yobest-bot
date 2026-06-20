/**
 * Yobest_BYTR Discord Bot  ·  v4.7 — AI SERVER BUILDER + SCRIPT ANNOUNCER + OWNER CONTROL
 * ==========================================================================================
 * WHAT'S NEW IN v4.7
 * ------------------------------------------------------------------------------------------
 *
 *  ✅ FIX: Channel name sanitizer — emoji are now preserved (was stripping all non-a-z0-9)
 *  ✅ FIX: /announcescript now accepts a `file` attachment option for unlimited-size scripts
 *          AND always attaches the full script as a downloadable file on the announcement post
 *  ✅ FIX: AI agent now has FULL Discord permissions:
 *          - set_channel_permission (ACL overwrites per role)
 *          - move_channel (set parent category)
 *          - set_channel_topic / set_channel_nsfw / set_channel_slowmode
 *          - set_role_color / set_role_hoist / set_role_mentionable / set_role_permissions
 *  ✅ NEW: /command — Owner natural language control
 *          - Free-form instruction: "ban @Marco for spam", "give @Alex the Mod role"
 *          - Resolves @mentions and usernames to real member IDs
 *          - ALL destructive actions (ban/kick/purge/delete) require a confirm button click
 *  ✅ All v4.6 features fully preserved
 * ==========================================================================================
 */

"use strict";

// ====================== DATABASE ======================
const db = require("./db");

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    PermissionsBitField,
    AttachmentBuilder,
} = require("discord.js");

// ====================== AI CONFIG ======================
const AI_DISPLAY_NAME     = "Yobest";
const OPENROUTER_MODEL    = "google/gemini-3-flash-preview";
const OPENROUTER_VISION   = "google/gemini-3-flash-preview";
const OPENROUTER_FALLBACK = "google/gemini-3-flash-preview";

let openaiClient = null;
try {
    const OpenAI = require("openai");
    if (process.env.OPENROUTER_API_KEY) {
        openaiClient = new (OpenAI.default || OpenAI)({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey:  process.env.OPENROUTER_API_KEY,
            defaultHeaders: {
                "HTTP-Referer": "https://yobest-bytr.vercel.app/",
                "X-Title":      "Yobest Discord Bot",
            },
        });
        console.log(`✅ AI ready — Primary: ${OPENROUTER_MODEL} | Fallback: ${OPENROUTER_FALLBACK}`);
    } else {
        console.warn("⚠️  OPENROUTER_API_KEY not set — AI features disabled.");
    }
} catch (e) {
    console.warn("⚠️  openai package not found — run: npm install openai");
}

// ====================== CLIENT ======================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
    ],
});

// ====================== STATE ======================
const aiEnabledChannels  = new Set();
const violationCount     = new Map();
const warnHistory        = new Map();
const spamTracker        = new Map();
const xpData             = new Map();
const customCmds         = new Map();
const reactionRoles      = new Map();
const ticketChannels     = new Set();
const guildSettings      = new Map();
const snipeData          = new Map();
const agentSessions      = new Map();   // "guildId:userId" → history[]
const pendingBuilds       = new Map();   // interactionId → { plan, userId, prompt }
const pendingAgentActions = new Map();  // token → { actions, userId, guildId }
const pendingOwnerActions = new Map();  // token → { actions, userId, guildId, channelId }
const scriptStore        = new Map();   // scriptId → { script, lang, title }

const startTime          = Date.now();
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || null;
const MODLOG_CHANNEL_ID  = process.env.MODLOG_CHANNEL_ID  || null;

let welcomeMessage =
    "Hey {user}, welcome aboard **{server}**! 🎉\n" +
    "You're member **#{count}** of our growing community.";

let goodbyeMessage =
    "Goodbye **{username}**, we'll miss you! 👋\n" +
    "**{server}** now has **{count}** members.";

// ====================== SITE INFO ======================
const SITE_INFO = {
    name: "Yobest Studio",
    url:  "https://yobest-bytr.vercel.app/",
    description:
        "Yobest Studio is a hub for Roblox games, AI tools, and a creator community. " +
        "It showcases Roblox game projects made by the Yobest/BYTR team, lets players " +
        "find links to play those games, and connects players with the community and updates.",
    links: { "Website": "https://yobest-bytr.vercel.app/" },
    highlights: [
        "Browse Roblox games made by the Yobest/BYTR team",
        "Find download/play links for the latest releases",
        "Join the community for updates and announcements",
    ],
};

// ====================== CONSTANTS ======================
const DANGEROUS_EXTS = /\.(exe|bat|cmd|scr|msi|jar|vbs|ps1|lnk|com|apk|dmg|sh|dll)$/i;
const SPAM_LIMIT     = 5;
const SPAM_WINDOW_MS = 60_000;
const MAX_SCRIPT_FILE_BYTES = 8 * 1024 * 1024; // 8MB

const SCRIPT_FILE_EXT_LANG = {
    lua: "lua", js: "javascript", mjs: "javascript", ts: "typescript",
    py: "python", txt: "txt", json: "txt", md: "txt",
    cs: "txt", cpp: "txt", c: "txt", java: "txt", rb: "txt", php: "txt",
};

const DESTRUCTIVE_AGENT_ACTIONS = new Set(["delete_channel", "delete_role"]);
const DESTRUCTIVE_OWNER_ACTIONS = new Set([
    "ban", "kick", "timeout", "purge", "delete_channel", "delete_role",
]);


// ---- PROFANITY PATTERNS ----
const PROFANITY_PATTERNS = [
    /\bsex\b/i, /\bporn\b/i, /\bporno\b/i, /\bxxx\b/i,
    /\bnude\b/i, /\bnudes\b/i, /\bdick\b/i, /\bcocks?\b/i,
    /\bpenis\b/i, /\bvagina\b/i, /\bpussy\b/i, /\bboob\b/i,
    /\bboobs\b/i, /\btits?\b/i, /\bbooty\b/i, /\bass\b(?!\w)/i,
    /\basshole\b/i, /\bcum\b/i, /\bjizz\b/i, /\bfap\b/i,
    /\bboner\b/i, /\bsuck\s*(my|this)\b/i, /\bfuck\b/i,
    /\bfucker\b/i, /\bfucking\b/i, /f+u+c+k+/i, /\bsh[i1]t\b/i,
    /\bbitch\b/i, /\bcunt\b/i, /\bwhore\b/i, /\bslut\b/i,
    /\bho\b(?!\w)/i, /\bskank\b/i, /\btramp\b/i, /\bn[i1]gg[ae]r/i,
    /\bn[i1]gg[a4]\b/i, /\bfagg?[o0]t/i, /\bretard\b/i, /\bspic\b/i,
    /\bchink\b/i, /\bkike\b/i, /\bwetback\b/i, /\bgook\b/i,
    /\bcracker\b/i, /\bkill\s+your?self\b/i, /\bkys\b/i, /\bkms\b/i,
    /\bkill\s+(him|her|them|you)\b/i, /\bi\s+will\s+kill\b/i,
    /\bi('ll)?\s+rape\b/i, /\brapist\b/i, /\bhitler\b/i,
    /\bnatzi\b/i, /\bnazi\b/i, /f+[*_\-]+c+k/i,
    /s+[*_\-]+x\b/i, /b[i1]+tch/i, /a+s+[*_\-]+hole/i,
];

// ---- SCAM DOMAINS ----
const SCAM_DOMAINS = [
    /discord-?nitro[\w-]*\.(?:com|net|gg|xyz|ru|tk|ml|ga|cf)/i,
    /free-?nitro[\w-]*\.(?:com|net|gg|xyz|ru)/i,
    /nitro-?gift[\w-]*\.(?:com|net|gg|xyz|ru)/i,
    /discordapp-?nitro\.[\w.]+/i,
    /free-?robux[\w-]*\.(?:com|net|xyz|ru|tk|ml)/i,
    /robux-?generator[\w-]*\.[\w.]+/i,
    /getrobux[\w-]*\.[\w.]+/i,
    /robuxhack[\w-]*\.[\w.]+/i,
    /discorcl\.com/i, /discord-app\.[\w.]+/i, /dlscord\.[\w.]+/i,
    /d1scord\.[\w.]+/i, /discrod\.[\w.]+/i,
    /steamcommunity-[\w-]+\.[\w.]+/i, /steam-?trade[\w-]*\.[\w.]+/i,
    /crypto-?gift[\w-]*\.[\w.]+/i, /bitcoin-?giv[\w-]*\.[\w.]+/i,
    /eth-?giv[\w-]*\.[\w.]+/i,
    /bytr[\w-]*yobest[\w-]*\.(?!vercel\.app)[\w.]+/i,
    /yobest[\w-]*\.(?!vercel\.app)[\w.]+/i,
    /beast-?casino[\w-]*\.[\w.]+/i,
    /mrbeast-?[\w-]*casino[\w-]*\.[\w.]+/i,
    /[\w-]*casino-?free[\w-]*\.[\w.]+/i,
    /[\w-]*free-?casino[\w-]*\.[\w.]+/i,
    /[\w-]*vynn[\w-]*\.[\w.]+/i,
    /mrbeast-?giv[\w-]*\.[\w.]+/i, /elon-?giv[\w-]*\.[\w.]+/i,
    /free-?gift-?card[\w-]*\.[\w.]+/i,
    /heloben\.com/i, /helobin\.com/i, /helaben\.com/i,
    /rakeback[\w-]*casino[\w-]*\.[\w.]+/i,
    /[\w-]*withdraw[\w-]*bonus[\w-]*\.[\w.]+/i,
    /beaston\.com/i, /beasto\.[\w.]+/i,
    /[\w-]*elonmusk[\w-]*giv[\w-]*\.[\w.]+/i,
    /[\w-]*cryptogiv[\w-]*\.[\w.]+/i,
    /[\w-]*nftgiv[\w-]*\.[\w.]+/i,
    /free[\w-]*bitcoin[\w-]*\.[\w.]+/i,
    /[\w-]*airdrop[\w-]*\.[\w.]+/i,
    /[\w-]*giftcard[\w-]*\.[\w.]+/i,
];

// ---- SCAM PHRASES ----
const SCAM_PHRASES = [
    /withdrawal\s+(of\s+\$[\d,]+\s+)?was\s+successfully/i,
    /your\s+withdrawal\s+of\s+\$[\d,.]+/i,
    /you\s+(have\s+)?won\s+\$[\d,.]+/i,
    /claim\s+your\s+(free\s+)?(prize|reward|winnings|crypto|robux|nitro)/i,
    /giving\s+away\s+\$[\d,.]+\s+to\s+everyone\s+who\s+registers?/i,
    /you\s+can\s+withdraw\s+the\s+(money|funds|balance|reward)\s+immediately/i,
    /launch\s+of\s+my\s+own\s+cryptocurrency\s+casino/i,
    /i\s+am\s+pleased\s+to\s+announce.{0,80}casino/i,
    /cryptocurrency\s+casino/i, /crypto\s+casino/i,
    /rakeback.{0,30}casino/i,
    /withdrawal\s+was\s+successfully/i,
    /your\s+balance\s+is\s+\$[\d,.]+/i,
    /withdraw.{0,20}immediately/i,
    /\$[\d,.]+\s+was\s+successfully/i,
    /successfully\s+credited\s+to\s+your/i,
    /your\s+(account|wallet)\s+has\s+been\s+credited/i,
    /bonus\s+code.{0,30}casino/i, /promo\s+code.{0,30}casino/i,
    /activate\s+code\s+for\s+bonus/i, /activate\s+(your\s+)?bonus/i,
    /\d+%\s+rakeback/i, /deposit.{0,20}bonus/i,
    /play\s+(and\s+)?win\s+\$[\d,.]+/i,
    /casino.{0,30}launch/i, /launch.{0,30}casino/i,
    /my\s+(own\s+)?crypto\s+casino/i, /online\s+casino/i,
    /gambling\s+site/i, /betting\s+site/i,
    /giving\s+away\s+.{0,50}\s+for\s+free/i,
    /i\s+am\s+giving\s+away\s+\$[\d,.]+/i,
    /free\s+(robux|nitro|steam|bitcoin|eth|crypto)\s+generator/i,
    /get\s+(free\s+)?(robux|nitro|steam\s+gift\s+card)\s+now/i,
    /mrbeast.{0,50}giveaway/i, /mrbeast.{0,50}casino/i,
    /elon\s*musk.{0,50}giveaway/i, /airdrop.{0,30}(free|claim|crypto)/i,
    /free\s+airdrop/i, /click\s+here\s+to\s+claim/i,
    /go\s+to\s*:\s*http/i,
    /send\s+\d+\s+(eth|btc|sol|usdt)\s+and\s+(receive|get|earn)\s+double/i,
    /double\s+your\s+(crypto|bitcoin|eth|money)/i,
    /click\s+(the\s+)?link.{0,20}claim/i,
    /dm\s+me\s+for\s+(free|your)/i,
    /join\s+now.{0,30}(free|claim|win|prize)/i,
    /verify\s+your\s+account\s+to\s+claim/i,
    /your\s+account\s+(will\s+be|is)\s+(suspended|banned|deleted)/i,
    /discord\s+nitro\s+for\s+free/i, /free\s+discord\s+nitro/i,
    /get\s+(free\s+)?nitro/i, /nitro\s+giveaway/i, /nitro\s+generator/i,
    /you\s+have\s+been\s+selected/i,
    /congratulations\s+you\s+(have\s+)?won/i,
    /you\s+are\s+the\s+(lucky\s+)?winner/i,
    /claim\s+your\s+reward\s+now/i,
    /limited\s+spots\s+available/i,
    /act\s+now.{0,30}(free|claim|win)/i,
    /follow\s+me\s+for\s+a\s+cookie/i,
];

// ---- MOTIVATIONAL QUOTES ----
const QUOTES = [
    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
    { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
    { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
    { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
    { text: "Keep your eyes on the stars, and your feet on the ground.", author: "Theodore Roosevelt" },
    { text: "You are never too old to set another goal or to dream a new dream.", author: "C.S. Lewis" },
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
    { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
    { text: "Dream big and dare to fail.", author: "Norman Vaughan" },
];

const XP_PER_MSG   = () => Math.floor(Math.random() * 10) + 5;
const XP_FOR_LEVEL = (lvl) => 100 * lvl * lvl;


// ====================== HELPERS ======================

function addXP(userId, amount, meta = {}) {
    const data  = xpData.get(userId) || { xp: 0, level: 0 };
    data.xp    += amount;
    let leveled = false;
    while (data.xp >= XP_FOR_LEVEL(data.level + 1)) {
        data.xp  -= XP_FOR_LEVEL(data.level + 1);
        data.level++;
        leveled = true;
    }
    xpData.set(userId, data);
    db.saveXP(userId, data, meta).catch(() => {});
    return { ...data, leveled };
}

function wrapSettings(guildId, obj) {
    return new Proxy(obj, {
        set(target, prop, value) {
            target[prop] = value;
            db.saveGuildSettings(guildId, target).catch(() => {});
            return true;
        },
    });
}

function getSettings(guildId) {
    if (!guildSettings.has(guildId)) {
        const obj = {
            modRoleId:        null,
            autoRoleId:       null,
            welcomeChannelId: WELCOME_CHANNEL_ID,
            goodbyeChannelId: null,
            modlogChannelId:  MODLOG_CHANNEL_ID,
            ticketCategoryId: null,
            welcomeMessage,
            goodbyeMessage,
        };
        guildSettings.set(guildId, wrapSettings(guildId, obj));
    }
    return guildSettings.get(guildId);
}

function getPermLevel(member, guild) {
    if (!member) return "member";
    if (guild.ownerId === member.id)                               return "owner";
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return "admin";
    const s = getSettings(guild.id);
    if (s.modRoleId && member.roles.cache.has(s.modRoleId))       return "mod";
    return "member";
}

function requireLevel(needed, actual) {
    const order = ["member", "mod", "admin", "owner"];
    return order.indexOf(actual) >= order.indexOf(needed);
}

function parseTime(str) {
    const m = str?.match(/^(\d+)(s|m|h)$/i);
    if (!m) return null;
    const amount = parseInt(m[1]);
    const unit   = m[2].toLowerCase();
    const ms     = unit === "h" ? amount * 3_600_000 : unit === "m" ? amount * 60_000 : amount * 1_000;
    return { ms, amount, unit };
}

function formatUptime(ms) {
    const s = Math.floor(ms / 1000)      % 60;
    const m = Math.floor(ms / 60_000)    % 60;
    const h = Math.floor(ms / 3_600_000) % 24;
    const d = Math.floor(ms / 86_400_000);
    return `${d}d ${h}h ${m}m ${s}s`;
}

function extractYouTubeId(input) {
    if (!input) return null;
    const t = input.trim();
    if (/^[a-zA-Z0-9_\-]{11}$/.test(t)) return t;
    const patterns = [
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_\-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_\-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_\-]{11})/,
    ];
    for (const p of patterns) { const m = t.match(p); if (m) return m[1]; }
    return t;
}

function extractUrl(input) {
    if (!input) return null;
    const t  = input.trim();
    const md = t.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (md) return md[1];
    const url = t.match(/https?:\/\/\S+/);
    if (url) return url[0];
    return t;
}

function addWarning(userId, reason, by, guildId = null) {
    const w = warnHistory.get(userId) || [];
    w.push({ reason, ts: Date.now(), by });
    warnHistory.set(userId, w);
    db.saveWarning(userId, guildId, reason, by).catch(() => {});
    return w;
}

function buildXPBar(current, needed) {
    const pct    = Math.min(current / needed, 1);
    const filled = Math.round(pct * 20);
    return `\`[${"█".repeat(filled)}${"░".repeat(20 - filled)}]\` ${Math.round(pct * 100)}%`;
}

function splitCode(code, max) {
    if (code.length <= max) return [code];
    const lines  = code.split("\n");
    const chunks = [];
    let cur      = "";
    for (const line of lines) {
        if ((cur + line + "\n").length > max) { chunks.push(cur); cur = ""; }
        cur += line + "\n";
    }
    if (cur) chunks.push(cur);
    return chunks;
}

/**
 * v4.7 FIX — emoji-safe channel name sanitizer.
 * v4.6 was too aggressive: stripped all non a-z0-9-hyphen (wiping emoji entirely).
 * Discord's real restrictions: no spaces (use hyphens), no backticks/zero-width chars,
 * max 100 chars. Emoji and unicode letters are allowed and preserved.
 */
function sanitizeChannelName(raw) {
    if (!raw) return "new-channel";
    let name = String(raw).trim();
    name = name.replace(/[\s_]+/g, "-");
    name = name.replace(/[`"'\u200B-\u200D\uFEFF\x00-\x1F]/g, "");
    name = name.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
    name = name.replace(/[A-Z]/g, (c) => c.toLowerCase());
    if (name.length > 100) name = name.slice(0, 100);
    return name || "new-channel";
}

function buildPermissionOverwriteObject(allowList = [], denyList = []) {
    const obj = {};
    for (const key of allowList) if (PermissionFlagsBits[key] !== undefined) obj[key] = true;
    for (const key of denyList)  if (PermissionFlagsBits[key] !== undefined) obj[key] = false;
    return obj;
}

function buildPermissionsBitfieldArray(keys = []) {
    return keys.filter(k => PermissionFlagsBits[k] !== undefined);
}


// ====================== SLASH COMMANDS ======================
const slashCommands = [
    // PUBLIC
    new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
    new SlashCommandBuilder().setName("stats").setDescription("Bot and server stats"),
    new SlashCommandBuilder().setName("serverinfo").setDescription("Info about this server"),
    new SlashCommandBuilder().setName("servericon").setDescription("Show the server icon"),
    new SlashCommandBuilder().setName("botinfo").setDescription("Detailed bot information"),
    new SlashCommandBuilder()
        .setName("userinfo").setDescription("Info about a user")
        .addUserOption(o => o.setName("user").setDescription("Target user")),
    new SlashCommandBuilder()
        .setName("avatar").setDescription("Show someone's avatar")
        .addUserOption(o => o.setName("user").setDescription("Target user")),
    new SlashCommandBuilder()
        .setName("roll").setDescription("Roll dice (e.g. 2d6)")
        .addStringOption(o => o.setName("dice").setDescription("NdS format e.g. 2d6").setRequired(true)),
    new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin"),
    new SlashCommandBuilder()
        .setName("rps").setDescription("Rock Paper Scissors vs the bot")
        .addStringOption(o => o.setName("choice").setDescription("Your pick").setRequired(true)
            .addChoices(
                { name: "🪨 Rock",     value: "rock"     },
                { name: "📄 Paper",    value: "paper"    },
                { name: "✂️ Scissors", value: "scissors" }
            )),
    new SlashCommandBuilder()
        .setName("8ball").setDescription("Ask the magic 8-ball")
        .addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true)),
    new SlashCommandBuilder().setName("quote").setDescription("Random motivational quote"),
    new SlashCommandBuilder()
        .setName("math").setDescription("Evaluate a math expression")
        .addStringOption(o => o.setName("expression").setDescription("e.g. 2+2 or 10*5-3").setRequired(true)),
    new SlashCommandBuilder()
        .setName("suggest").setDescription("Submit a suggestion")
        .addStringOption(o => o.setName("idea").setDescription("Your idea").setRequired(true)),
    new SlashCommandBuilder()
        .setName("poll").setDescription("Create a poll")
        .addStringOption(o => o.setName("question").setDescription("Poll question").setRequired(true))
        .addStringOption(o => o.setName("options").setDescription("Options separated by | (e.g. Yes | No | Maybe)").setRequired(true)),
    new SlashCommandBuilder()
        .setName("report").setDescription("Report a user to admins")
        .addUserOption(o => o.setName("user").setDescription("User to report").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),
    new SlashCommandBuilder()
        .setName("remindme").setDescription("Set a reminder (DM)")
        .addStringOption(o => o.setName("time").setDescription("Time e.g. 30m or 2h").setRequired(true))
        .addStringOption(o => o.setName("text").setDescription("Reminder text").setRequired(true)),
    new SlashCommandBuilder().setName("site").setDescription("Show Yobest Studio website info"),
    new SlashCommandBuilder().setName("discord").setDescription("Get the Discord invite link"),
    new SlashCommandBuilder().setName("rank").setDescription("Show your XP rank"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Top 10 XP leaderboard"),
    new SlashCommandBuilder().setName("ticket").setDescription("Open a support ticket"),
    new SlashCommandBuilder().setName("snipe").setDescription("Show last deleted message in this channel"),
    new SlashCommandBuilder().setName("help").setDescription("Show all commands"),

    // AI SERVER BUILDER
    new SlashCommandBuilder()
        .setName("generate")
        .setDescription("[Admin] AI Server Builder — generate a full server layout from a prompt")
        .addStringOption(o => o.setName("prompt")
            .setDescription("Describe your server (e.g. 'Gaming community with Minecraft and Valorant sections')")
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName("agent")
        .setDescription("[Admin] AI Server Agent — edit your server with natural language (full permissions)")
        .addStringOption(o => o.setName("instruction")
            .setDescription("What to do (e.g. 'rename #general to 🎮-gaming, make it read-only for @everyone')")
            .setRequired(true)),
    new SlashCommandBuilder()
        .setName("agentclear")
        .setDescription("[Admin] Clear your AI agent conversation session"),

    // OWNER NATURAL LANGUAGE CONTROL
    new SlashCommandBuilder()
        .setName("command")
        .setDescription("[Owner] Talk to the bot in plain language — ban/kick/role/message/etc")
        .addStringOption(o => o.setName("instruction")
            .setDescription("e.g. 'ban @Marco for spamming' or 'give @Alex the Moderator role'")
            .setRequired(true)),

    // SCRIPT ANNOUNCER
    new SlashCommandBuilder()
        .setName("announcescript")
        .setDescription("[Admin] Post a script announcement with copy/download buttons")
        .addStringOption(o => o.setName("title").setDescription("Title of the script/update").setRequired(true))
        .addStringOption(o => o.setName("desc").setDescription("Description of what the script does").setRequired(true))
        .addStringOption(o => o.setName("script").setDescription("Paste script here (for short scripts — use 'file' for large ones)").setRequired(false))
        .addAttachmentOption(o => o.setName("file").setDescription("Upload script as a file (recommended for large scripts — no size limit)").setRequired(false))
        .addStringOption(o => o.setName("language").setDescription("Script language (default: lua; auto-detected from file extension)").setRequired(false)
            .addChoices(
                { name: "Lua",        value: "lua"        },
                { name: "JavaScript", value: "javascript" },
                { name: "Python",     value: "python"     },
                { name: "TypeScript", value: "typescript" },
                { name: "Other/Text", value: "txt"        }
            ))
        .addStringOption(o => o.setName("video").setDescription("YouTube video ID or URL (optional)").setRequired(false))
        .addStringOption(o => o.setName("download").setDescription("Extra download link (optional)").setRequired(false)),

    // MOD+
    new SlashCommandBuilder()
        .setName("warn").setDescription("[Mod] Warn a user")
        .addUserOption(o => o.setName("user").setDescription("User to warn").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),
    new SlashCommandBuilder()
        .setName("warnings").setDescription("[Mod] View warnings for a user")
        .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),
    new SlashCommandBuilder()
        .setName("clearwarnings").setDescription("[Mod] Clear all warnings for a user")
        .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),
    new SlashCommandBuilder()
        .setName("mute").setDescription("[Mod] Timeout a user")
        .addUserOption(o => o.setName("user").setDescription("User to mute").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
        .setName("unmute").setDescription("[Mod] Remove timeout from a user")
        .addUserOption(o => o.setName("user").setDescription("User to unmute").setRequired(true)),
    new SlashCommandBuilder()
        .setName("purge").setDescription("[Mod] Delete messages")
        .addIntegerOption(o => o.setName("count").setDescription("How many to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder()
        .setName("slowmode").setDescription("[Mod] Set channel slowmode")
        .addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0=off)").setRequired(true).setMinValue(0).setMaxValue(21600)),
    new SlashCommandBuilder().setName("lock").setDescription("[Mod] Lock this channel"),
    new SlashCommandBuilder().setName("unlock").setDescription("[Mod] Unlock this channel"),
    new SlashCommandBuilder().setName("closeticket").setDescription("[Mod] Close this support ticket"),
    new SlashCommandBuilder()
        .setName("setnickname").setDescription("[Mod] Change a user's nickname")
        .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
        .addStringOption(o => o.setName("nickname").setDescription("New nickname (leave blank to reset)")),

    // ADMIN+
    new SlashCommandBuilder()
        .setName("ban").setDescription("[Admin] Ban a user")
        .addUserOption(o => o.setName("user").setDescription("User to ban").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
        .setName("kick").setDescription("[Admin] Kick a user")
        .addUserOption(o => o.setName("user").setDescription("User to kick").setRequired(true))
        .addStringOption(o => o.setName("reason").setDescription("Reason")),
    new SlashCommandBuilder()
        .setName("announce").setDescription("[Admin] Post an announcement")
        .addStringOption(o => o.setName("title").setDescription("Title").setRequired(true))
        .addStringOption(o => o.setName("desc").setDescription("Description").setRequired(true))
        .addStringOption(o => o.setName("video").setDescription("YouTube ID or URL"))
        .addStringOption(o => o.setName("download").setDescription("Download link"))
        .addStringOption(o => o.setName("roblox").setDescription("Roblox game link")),
    new SlashCommandBuilder()
        .setName("giveaway").setDescription("[Admin] Start a giveaway")
        .addStringOption(o => o.setName("time").setDescription("Duration e.g. 10m or 1h").setRequired(true))
        .addStringOption(o => o.setName("prize").setDescription("Prize description").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setwelcome").setDescription("[Admin] Set the welcome message")
        .addStringOption(o => o.setName("message").setDescription("Use {user} {server} {count}").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setgoodbyemsg").setDescription("[Admin] Set the goodbye message")
        .addStringOption(o => o.setName("message").setDescription("Use {username} {server} {count}").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setmodrole").setDescription("[Admin] Set the moderator role")
        .addRoleOption(o => o.setName("role").setDescription("Moderator role").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setautorole").setDescription("[Admin] Auto-assign role on join")
        .addRoleOption(o => o.setName("role").setDescription("Role to auto-assign").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setwelcomechannel").setDescription("[Admin] Set the welcome channel")
        .addChannelOption(o => o.setName("channel").setDescription("Welcome channel").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setgoodbyechannel").setDescription("[Admin] Set the goodbye/leave channel")
        .addChannelOption(o => o.setName("channel").setDescription("Goodbye channel").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setmodlogchannel").setDescription("[Admin] Set the mod-log channel")
        .addChannelOption(o => o.setName("channel").setDescription("Mod-log channel").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setticketcategory").setDescription("[Admin] Set category for ticket channels")
        .addChannelOption(o => o.setName("category").setDescription("Category channel").setRequired(true)),
    new SlashCommandBuilder()
        .setName("enableai").setDescription("[Admin] Enable AI chat in this channel"),
    new SlashCommandBuilder()
        .setName("disableai").setDescription("[Admin] Disable AI chat in this channel"),
    new SlashCommandBuilder()
        .setName("addcmd").setDescription("[Admin] Add a custom command")
        .addStringOption(o => o.setName("trigger").setDescription("!trigger word").setRequired(true))
        .addStringOption(o => o.setName("response").setDescription("Bot response").setRequired(true)),
    new SlashCommandBuilder()
        .setName("removecmd").setDescription("[Admin] Remove a custom command")
        .addStringOption(o => o.setName("trigger").setDescription("Trigger to remove").setRequired(true)),
    new SlashCommandBuilder().setName("listcmds").setDescription("[Admin] List all custom commands"),
    new SlashCommandBuilder()
        .setName("reactionrole").setDescription("[Admin] Set up a reaction role")
        .addStringOption(o => o.setName("messageid").setDescription("Message ID to watch").setRequired(true))
        .addStringOption(o => o.setName("emoji").setDescription("Emoji to react with").setRequired(true))
        .addRoleOption(o => o.setName("role").setDescription("Role to assign").setRequired(true)),
    new SlashCommandBuilder()
        .setName("clearxp").setDescription("[Admin] Reset XP for a user")
        .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),

    // GAME CATALOG
    new SlashCommandBuilder()
        .setName("addgame").setDescription("[Admin] Add a game to the website catalog")
        .addStringOption(o => o.setName("title").setDescription("Game title").setRequired(true))
        .addStringOption(o => o.setName("description").setDescription("Short description"))
        .addStringOption(o => o.setName("link").setDescription("Roblox play URL"))
        .addStringOption(o => o.setName("image").setDescription("Cover image URL")),
    new SlashCommandBuilder()
        .setName("removegame").setDescription("[Admin] Remove a game from the website catalog")
        .addStringOption(o => o.setName("title").setDescription("Exact game title").setRequired(true)),
    new SlashCommandBuilder()
        .setName("listgames").setDescription("[Admin] Show all games in the catalog"),

    // OWNER
    new SlashCommandBuilder().setName("scanandclean").setDescription("[Owner] Scan + clean last 100 messages"),
    new SlashCommandBuilder().setName("testautomod").setDescription("[Owner] Test the auto-mod pipeline"),
    new SlashCommandBuilder().setName("aitest").setDescription("[Owner] Test AI connection"),
].map(cmd => cmd.toJSON());


// ====================== REGISTER SLASH COMMANDS ======================
async function registerSlashCommands() {
    const token    = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;
    if (!clientId) { console.warn("⚠️  CLIENT_ID not set — skipping slash registration."); return; }
    try {
        const rest = new REST({ version: "10" }).setToken(token);
        for (const guild of client.guilds.cache.values()) {
            try {
                await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body: slashCommands });
                console.log(`✅ Commands registered in: ${guild.name}`);
            } catch (e) { console.error(`❌ Failed in ${guild.name}:`, e.message); }
        }
        console.log("✅ Slash command registration complete.");
    } catch (e) { console.error("❌ Slash registration failed:", e.message); }
}

// ====================== READY ======================
client.once("ready", async () => {
    console.log(`✅ Yobest_BYTR Bot v4.7 Online — ${client.user.tag}`);
    client.user.setActivity("🛡️ Protecting the server | v4.7", { type: 3 });

    // ---- Neon: init schema + hydrate in-memory state ----
    await db.initSchema();
    const state = await db.loadAllState();

    // guild settings
    for (const row of (state.guildSettings || [])) {
        const obj = {
            modRoleId:        row.mod_role_id,
            autoRoleId:       row.auto_role_id,
            welcomeChannelId: row.welcome_channel || WELCOME_CHANNEL_ID,
            goodbyeChannelId: row.goodbye_channel,
            modlogChannelId:  row.modlog_channel  || MODLOG_CHANNEL_ID,
            ticketCategoryId: row.ticket_category,
            welcomeMessage:   row.welcome_message || welcomeMessage,
            goodbyeMessage:   row.goodbye_message || goodbyeMessage,
        };
        guildSettings.set(row.guild_id, wrapSettings(row.guild_id, obj));
    }
    // XP
    for (const row of (state.xp || [])) xpData.set(row.user_id, { xp: row.xp, level: row.level });
    // warnings (rebuild warnHistory Map)
    for (const row of (state.warnings || [])) {
        const w = warnHistory.get(row.user_id) || [];
        w.push({ reason: row.reason, ts: new Date(row.ts).getTime(), by: row.warned_by });
        warnHistory.set(row.user_id, w);
    }
    // custom commands
    for (const row of (state.customCommands || [])) {
        const map = customCmds.get(row.guild_id) || new Map();
        map.set(row.trigger, row.response);
        customCmds.set(row.guild_id, map);
    }
    // reaction roles
    for (const row of (state.reactionRoles || []))
        reactionRoles.set(`${row.guild_id}:${row.message_id}:${row.emoji}`, row.role_id);
    // open tickets
    for (const channelId of (state.openTickets || [])) ticketChannels.add(channelId);
    // scripts
    for (const row of (state.scripts || []))
        scriptStore.set(row.script_id, { script: row.script, lang: row.lang, title: row.title });

    console.log(`✅ Hydrated from Neon: ${(state.xp||[]).length} XP rows, ${(state.warnings||[]).length} warnings, ${(state.openTickets||[]).length} open tickets.`);

    // ---- snapshot guild stats immediately + every 5 min ----
    const snapshotAll = () => {
        for (const g of client.guilds.cache.values()) db.upsertGuildSnapshot(g).catch(() => {});
    };
    snapshotAll();
    setInterval(snapshotAll, 5 * 60 * 1000);

    await registerSlashCommands();
    await runStartupSelfTest();
});

async function runStartupSelfTest() {
    if (!MODLOG_CHANNEL_ID) return;
    try {
        let ch = null;
        for (const g of client.guilds.cache.values()) {
            ch = g.channels.cache.get(MODLOG_CHANNEL_ID);
            if (ch) break;
        }
        if (!ch) return;
        const embed = new EmbedBuilder()
            .setTitle("✅ Yobest Bot v4.7 — Online")
            .setColor(0x00FFAA)
            .setDescription("v4.7 — Full agent permissions, owner /command, emoji channel names, large-script support.")
            .addFields(
                { name: "🛡️ Auto-Mod",        value: "✅ Instant regex + AI vision", inline: false },
                { name: "🤬 Profanity",        value: `✅ ${PROFANITY_PATTERNS.length} patterns`, inline: true },
                { name: "📝 Scam Phrases",     value: `✅ ${SCAM_PHRASES.length} patterns`, inline: true },
                { name: "🔗 Scam Domains",     value: `✅ ${SCAM_DOMAINS.length} patterns`, inline: true },
                { name: "🏗️ AI Builder",       value: "✅ /generate", inline: false },
                { name: "🤖 AI Agent",         value: "✅ /agent — full ACL + role permissions", inline: true },
                { name: "👑 Owner Control",    value: "✅ /command — plain language, confirm-gated", inline: true },
                { name: "📜 Script Announcer", value: "✅ /announcescript — file upload supported", inline: false },
                { name: "🧠 AI Model",         value: OPENROUTER_MODEL, inline: false },
            )
            .setFooter({ text: "Yobest_BYTR Bot v4.7" })
            .setTimestamp();
        await ch.send({ embeds: [embed] });
    } catch (e) { console.error("Startup self-test error:", e); }
}

// ====================== EVENTS ======================
client.on("guildMemberAdd", async (member) => {
    try {
        db.upsertGuildSnapshot(member.guild).catch(() => {});
        const s = getSettings(member.guild.id);
        if (s.autoRoleId) {
            const role = member.guild.roles.cache.get(s.autoRoleId);
            if (role) await member.roles.add(role).catch(() => {});
        }
        const ch = member.guild.channels.cache.get(s.welcomeChannelId) || member.guild.systemChannel;
        if (!ch) return;
        const desc = (s.welcomeMessage || welcomeMessage)
            .replace(/{user}/g,   `${member}`)
            .replace(/{server}/g, member.guild.name)
            .replace(/{count}/g,  `${member.guild.memberCount}`);
        const embed = new EmbedBuilder()
            .setColor(0x00FFAA)
            .setTitle(`👋 ${member.user.username} just joined!`)
            .setDescription(`${desc}\n\n🔗 [${SITE_INFO.name}](${SITE_INFO.url})`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: `Member #${member.guild.memberCount}` })
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Visit Yobest Studio").setStyle(ButtonStyle.Link).setURL(SITE_INFO.url).setEmoji("🌐"),
            new ButtonBuilder().setLabel("Roblox Games").setStyle(ButtonStyle.Link).setURL("https://www.roblox.com/groups/33690332/Yobest-Studio#!/games").setEmoji("🎮")
        );
        await ch.send({ content: `${member}`, embeds: [embed], components: [row] });
    } catch (e) { console.error("Welcome error:", e); }
});

client.on("guildMemberRemove", async (member) => {
    try {
        db.upsertGuildSnapshot(member.guild).catch(() => {});
        const s = getSettings(member.guild.id);
        if (!s.goodbyeChannelId) return;
        const ch = member.guild.channels.cache.get(s.goodbyeChannelId);
        if (!ch) return;
        const msg = (s.goodbyeMessage || goodbyeMessage)
            .replace(/{user}/g,     `${member}`)
            .replace(/{username}/g, member.user.username)
            .replace(/{server}/g,   member.guild.name)
            .replace(/{count}/g,    `${member.guild.memberCount}`);
        const embed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle(`👋 ${member.user.username} has left`)
            .setDescription(msg)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: `${member.guild.name} now has ${member.guild.memberCount} members` })
            .setTimestamp();
        await ch.send({ embeds: [embed] });
    } catch (e) { console.error("Goodbye error:", e); }
});

client.on("messageDelete", (message) => {
    if (message.author?.bot) return;
    if (!message.content && !message.attachments.size) return;
    snipeData.set(message.channelId, {
        content:   message.content || "*(no text)*",
        author:    message.author?.tag || "Unknown",
        avatarURL: message.author?.displayAvatarURL({ dynamic: true }) || null,
        timestamp: Date.now(),
    });
});

client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return;
    const key = `${reaction.message.guildId}:${reaction.message.id}:${reaction.emoji.toString()}`;
    const rid = reactionRoles.get(key);
    if (!rid) return;
    try {
        const m = await reaction.message.guild.members.fetch(user.id);
        const r = reaction.message.guild.roles.cache.get(rid);
        if (r) await m.roles.add(r);
    } catch {}
});

client.on("messageReactionRemove", async (reaction, user) => {
    if (user.bot) return;
    const key = `${reaction.message.guildId}:${reaction.message.id}:${reaction.emoji.toString()}`;
    const rid = reactionRoles.get(key);
    if (!rid) return;
    try {
        const m = await reaction.message.guild.members.fetch(user.id);
        const r = reaction.message.guild.roles.cache.get(rid);
        if (r) await m.roles.remove(r);
    } catch {}
});


// ═══════════════════════════════════════════════════════════════
//  SLASH COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════
client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) { await handleButtonInteraction(interaction); return; }
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, guild } = interaction;
    const permLevel = getPermLevel(member, guild);

    const reply = async (opts, ephemeral = false) => {
        if (typeof opts === "string") opts = { content: opts };
        opts.ephemeral = ephemeral;
        if (interaction.deferred || interaction.replied) return interaction.editReply(opts);
        return interaction.reply(opts);
    };
    const replyErr = (msg) => reply(`❌ ${msg}`, true);

    try {
        // ---- PUBLIC ----
        if (commandName === "ping") {
            await interaction.deferReply();
            const ms = Date.now() - interaction.createdTimestamp;
            return reply(`🏓 Pong! Latency: **${ms}ms** | API: **${Math.round(client.ws.ping)}ms**`);
        }
        if (commandName === "stats")      return reply({ embeds: [buildStatsEmbed(guild)] });
        if (commandName === "serverinfo") return reply({ embeds: [buildServerInfoEmbed(guild)] });
        if (commandName === "botinfo")    return reply({ embeds: [buildBotInfoEmbed()] });
        if (commandName === "servericon") {
            const icon = guild.iconURL({ dynamic: true, size: 1024 });
            if (!icon) return replyErr("This server has no icon.");
            return reply({ embeds: [new EmbedBuilder().setTitle(`🏠 ${guild.name} — Icon`).setColor(0x00FFAA).setImage(icon)] });
        }
        if (commandName === "userinfo") {
            const target = interaction.options.getMember("user") || member;
            return reply({ embeds: [buildUserInfoEmbed(target, guild)] });
        }
        if (commandName === "avatar") {
            const u = interaction.options.getUser("user") || member.user;
            return reply({ embeds: [new EmbedBuilder().setTitle(`🖼️ ${u.tag}`).setColor(0x00FFAA).setImage(u.displayAvatarURL({ dynamic: true, size: 1024 }))] });
        }
        if (commandName === "roll") {
            const arg = interaction.options.getString("dice");
            const m   = arg.match(/^(\d+)d(\d+)$/i);
            if (!m) return replyErr("Format: `NdS` e.g. `2d6`");
            const count = Math.min(parseInt(m[1]), 100);
            const sides = Math.min(parseInt(m[2]), 1000);
            const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
            return reply(`🎲 **${count}d${sides}**: [${rolls.join(", ")}] → **${rolls.reduce((a, b) => a + b, 0)}**`);
        }
        if (commandName === "coinflip") return reply(Math.random() < 0.5 ? "🪙 Heads!" : "🟡 Tails!");
        if (commandName === "rps") {
            const choices = ["rock", "paper", "scissors"];
            const emojis  = { rock: "🪨", paper: "📄", scissors: "✂️" };
            const up      = interaction.options.getString("choice");
            const bp      = choices[Math.floor(Math.random() * 3)];
            let out = "🤝 It's a tie!";
            if ((up==="rock"&&bp==="scissors")||(up==="paper"&&bp==="rock")||(up==="scissors"&&bp==="paper")) out = "🎉 You win!";
            else if (up !== bp) out = "😞 Bot wins!";
            return reply(`You: **${emojis[up]} ${up}** vs Bot: **${emojis[bp]} ${bp}**\n${out}`);
        }
        if (commandName === "8ball") {
            const q = interaction.options.getString("question");
            const a = ["Yes, definitely.","It is certain.","Without a doubt.","Most likely.","Probably not.","Don't count on it.","My sources say no.","Ask again later.","Cannot predict now.","Absolutely not.","Signs point to yes."];
            return reply({ embeds: [new EmbedBuilder().setTitle("🎱 Magic 8-Ball").setColor(0x00FFAA).addFields({ name: "❓ Question", value: q }, { name: "💬 Answer", value: a[Math.floor(Math.random() * a.length)] })] });
        }
        if (commandName === "quote") {
            const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
            return reply({ embeds: [new EmbedBuilder().setTitle("💬 Motivational Quote").setColor(0x00FFAA).setDescription(`*"${q.text}"*\n\n— **${q.author}**`).setTimestamp()] });
        }
        if (commandName === "math") {
            const expr = interaction.options.getString("expression");
            try {
                const safe = expr.replace(/[^0-9+\-*/().%\s]/g, "");
                if (!safe.trim()) return replyErr("Invalid expression.");
                // eslint-disable-next-line no-new-func
                const result = Function(`"use strict"; return (${safe})`)();
                if (typeof result !== "number" || !isFinite(result)) return replyErr("Not a valid number.");
                return reply(`🧮 \`${safe}\` = **${result}**`);
            } catch { return replyErr("Could not evaluate. Try: `2+2` or `10*5-3`"); }
        }
        if (commandName === "suggest") {
            const idea = interaction.options.getString("idea");
            const sent = await interaction.channel.send({ embeds: [new EmbedBuilder().setTitle("💡 New Suggestion").setColor(0x00FFAA).setDescription(idea).setFooter({ text: `Suggested by ${member.user.tag}` }).setTimestamp()] });
            await sent.react("👍").catch(() => {});
            await sent.react("👎").catch(() => {});
            return reply("✅ Suggestion posted!", true);
        }
        if (commandName === "poll") {
            const question = interaction.options.getString("question");
            const opts     = interaction.options.getString("options").split("|").map(s => s.trim()).filter(Boolean);
            if (opts.length < 2) return replyErr("Need at least 2 options separated by `|`");
            const nums  = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];
            const embed = new EmbedBuilder().setTitle(`📊 ${question}`).setColor(0x00FFAA).setDescription(opts.slice(0, 9).map((o, i) => `${nums[i]} ${o}`).join("\n")).setFooter({ text: `Poll by ${member.user.tag}` }).setTimestamp();
            const sent  = await interaction.channel.send({ embeds: [embed] });
            for (let i = 0; i < Math.min(opts.length, 9); i++) await sent.react(nums[i]).catch(() => {});
            return reply("✅ Poll posted!", true);
        }
        if (commandName === "report") {
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason");
            if (!target) return replyErr("User not found.");
            await handleReportCore({ author: member.user, member, guild, channel: interaction.channel, url: "" }, target, reason, guild);
            return reply("✅ Report sent to admins.", true);
        }
        if (commandName === "remindme") {
            const timeStr = interaction.options.getString("time");
            const text    = interaction.options.getString("text");
            const res     = parseTime(timeStr);
            if (!res) return replyErr("Format: `30m` or `2h`");
            if (res.ms > 24 * 3_600_000) return replyErr("Max is 24 hours.");
            await reply(`⏰ Got it! Reminding you in **${timeStr}**.`);
            setTimeout(async () => {
                await member.user.send(`⏰ **Reminder!**\n${text}\n\n*(Set in ${guild.name})*`).catch(async () => {
                    await interaction.channel.send(`${member.user} ⏰ Reminder: **${text}**`).catch(() => {});
                });
            }, res.ms);
            return;
        }
        if (commandName === "site")    return reply({ embeds: [buildSiteEmbed()], components: [buildSiteRow()] });
        if (commandName === "discord") return reply("🔗 **Join our Discord:** https://discord.gg/yobest");
        if (commandName === "rank") {
            const d = xpData.get(member.id) || { xp: 0, level: 0 };
            const n = XP_FOR_LEVEL(d.level + 1);
            return reply({ embeds: [new EmbedBuilder().setColor(0x00FFAA).setTitle(`⭐ ${member.user.tag}'s Rank`).setThumbnail(member.user.displayAvatarURL({ dynamic: true })).addFields({ name: "Level", value: `**${d.level}**`, inline: true }, { name: "XP", value: `**${d.xp} / ${n}**`, inline: true }).setDescription(buildXPBar(d.xp, n)).setTimestamp()] });
        }
        if (commandName === "leaderboard") return reply({ embeds: [buildLeaderboard(guild)] });
        if (commandName === "ticket")      return await handleTicketSlash(interaction, member, guild, reply, replyErr);
        if (commandName === "snipe") {
            const d = snipeData.get(interaction.channelId);
            if (!d) return reply("🎯 Nothing to snipe recently.");
            return reply({ embeds: [new EmbedBuilder().setTitle("🎯 Sniped Message").setColor(0xFF8800).setDescription(d.content.slice(0, 2000)).setAuthor({ name: d.author, iconURL: d.avatarURL || undefined }).setTimestamp(d.timestamp)] });
        }
        if (commandName === "help") return reply({ embeds: [buildHelpEmbed(permLevel)] });

        // ---- AI SERVER BUILDER ----
        if (commandName === "generate") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            if (!openaiClient) return replyErr("AI is not configured. Set `OPENROUTER_API_KEY`.");
            await interaction.deferReply();
            const prompt = interaction.options.getString("prompt");
            await reply(`🏗️ **AI Server Builder** generating layout for:\n> *${prompt}*\n\n⏳ Working...`);
            let plan;
            try { plan = await generateServerPlan(prompt); }
            catch (e) { return reply(`❌ AI failed: ${e.message}`); }
            const previewEmbed = buildServerPlanEmbed(plan, prompt);
            const confirmRow   = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`build_confirm_${interaction.id}`).setLabel("✅ Build It").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`build_cancel_${interaction.id}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Danger),
            );
            pendingBuilds.set(interaction.id, { plan, userId: member.id, prompt });
            setTimeout(() => pendingBuilds.delete(interaction.id), 300_000);
            return reply({ content: "**📋 Preview — Does this look good?**", embeds: [previewEmbed], components: [confirmRow] });
        }

        // ---- AI SERVER AGENT ----
        if (commandName === "agent") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            if (!openaiClient) return replyErr("AI is not configured. Set `OPENROUTER_API_KEY`.");
            await interaction.deferReply();
            const instruction = interaction.options.getString("instruction");
            const sessionKey  = `${guild.id}:${member.id}`;
            const history     = agentSessions.get(sessionKey) || [];
            history.push({ role: "user", content: instruction });
            const ctx = buildGuildContext(guild);
            let aiResponse;
            try { aiResponse = await runAgentTurn(ctx, history); }
            catch (e) { return reply(`❌ Agent error: ${e.message}`); }
            history.push({ role: "assistant", content: aiResponse.message });
            if (history.length > 20) history.splice(0, history.length - 20);
            agentSessions.set(sessionKey, history);

            const allActions  = aiResponse.actions || [];
            const destructive = allActions.filter(a => DESTRUCTIVE_AGENT_ACTIONS.has(a.type));
            const safeActions = allActions.filter(a => !DESTRUCTIVE_AGENT_ACTIONS.has(a.type));
            const results     = await executeAgentActions(safeActions, guild);

            const embed = new EmbedBuilder()
                .setTitle("🤖 AI Agent Response").setColor(0x5865F2)
                .setDescription(aiResponse.message)
                .setFooter({ text: "Use /agentclear to reset" }).setTimestamp();
            if (results.length) embed.addFields({ name: "✅ Actions Taken", value: results.map(r => `• ${r}`).join("\n").slice(0, 1024) });

            const components = [];
            if (destructive.length) {
                const token = `${interaction.id}`;
                pendingAgentActions.set(token, { actions: destructive, userId: member.id, guildId: guild.id });
                setTimeout(() => pendingAgentActions.delete(token), 300_000);
                embed.addFields({ name: "⚠️ Needs Confirmation (destructive)", value: destructive.map(a => `• ${describeAgentAction(a, guild)}`).join("\n").slice(0, 1024) });
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`agent_confirm_${token}`).setLabel("✅ Confirm").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`agent_cancel_${token}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
                ));
            }
            return reply({ embeds: [embed], components });
        }

        if (commandName === "agentclear") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            agentSessions.delete(`${guild.id}:${member.id}`);
            return reply("✅ Agent session cleared.", true);
        }

        // ---- OWNER NATURAL LANGUAGE CONTROL ----
        if (commandName === "command") {
            if (guild.ownerId !== member.id) return replyErr("This command is restricted to the server owner.");
            if (!openaiClient) return replyErr("AI is not configured. Set `OPENROUTER_API_KEY`.");
            await interaction.deferReply();
            const instruction = interaction.options.getString("instruction");
            let parsed;
            try { parsed = await runOwnerCommandTurn(instruction, guild); }
            catch (e) { return reply(`❌ Could not parse instruction: ${e.message}`); }

            const destructive = (parsed.actions || []).filter(a => DESTRUCTIVE_OWNER_ACTIONS.has(a.type));
            const safeActions = (parsed.actions || []).filter(a => !DESTRUCTIVE_OWNER_ACTIONS.has(a.type));
            const results     = await executeOwnerActions(safeActions, guild, interaction.channel);

            const embed = new EmbedBuilder()
                .setTitle("👑 Owner Command").setColor(0xF1C40F)
                .setDescription(parsed.message || "Done.").setTimestamp();
            if (results.length) embed.addFields({ name: "✅ Done", value: results.map(r => `• ${r}`).join("\n").slice(0, 1024) });

            const components = [];
            if (destructive.length) {
                const token = `${interaction.id}`;
                pendingOwnerActions.set(token, { actions: destructive, userId: member.id, guildId: guild.id, channelId: interaction.channel.id });
                setTimeout(() => pendingOwnerActions.delete(token), 300_000);
                embed.addFields({ name: "⚠️ Requires Confirmation", value: destructive.map(a => `• ${describeOwnerAction(a, guild)}`).join("\n").slice(0, 1024) });
                components.push(new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`owner_confirm_${token}`).setLabel("✅ Confirm").setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId(`owner_cancel_${token}`).setLabel("❌ Cancel").setStyle(ButtonStyle.Secondary),
                ));
            }
            return reply({ embeds: [embed], components });
        }

        // ---- SCRIPT ANNOUNCER ----
        if (commandName === "announcescript") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            await interaction.deferReply({ ephemeral: true });
            const title     = interaction.options.getString("title");
            const desc      = interaction.options.getString("desc");
            const scriptStr = interaction.options.getString("script");
            const file       = interaction.options.getAttachment("file");
            let   lang       = interaction.options.getString("language") || "lua";
            const ytRaw      = interaction.options.getString("video");
            const dlLink     = interaction.options.getString("download");
            const ytId       = ytRaw ? extractYouTubeId(ytRaw) : null;

            if (!scriptStr && !file) return reply("❌ Provide either `script` (text) or `file` (attachment) — at least one is required.", true);

            let script;
            if (file) {
                if (file.size > MAX_SCRIPT_FILE_BYTES)
                    return reply(`❌ File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is ${MAX_SCRIPT_FILE_BYTES / 1024 / 1024}MB.`, true);
                try {
                    const res = await fetch(file.url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    script = await res.text();
                } catch (e) { return reply(`❌ Could not download the attached file: ${e.message}`, true); }
                const ext = (file.name.split(".").pop() || "").toLowerCase();
                if (SCRIPT_FILE_EXT_LANG[ext]) lang = SCRIPT_FILE_EXT_LANG[ext];
            } else {
                script = scriptStr;
            }
            if (!script?.trim()) return reply("❌ The script content was empty.", true);

            await postScriptAnnouncement(interaction.channel, { title, desc, script, lang, ytId, dlLink, authorTag: member.user.tag });
            return reply("✅ Script announcement posted!");
        }

        // ---- MOD+ ----
        if (commandName === "warn") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason");
            if (!target) return replyErr("User not found.");
            const warns = addWarning(target.id, reason, member.user.tag, guild.id);
            await target.send(`⚠️ You were **warned** in **${guild.name}**.\nReason: **${reason}**\nWarning #${warns.length}`).catch(() => {});
            return reply(`⚠️ ${target} warned (${warns.length} total). Reason: **${reason}**`);
        }
        if (commandName === "warnings") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target = interaction.options.getMember("user");
            if (!target) return replyErr("User not found.");
            const warns = warnHistory.get(target.id) || [];
            if (!warns.length) return reply(`✅ ${target} has no warnings.`);
            return reply({ embeds: [buildWarningsEmbed(target.user, warns)] });
        }
        if (commandName === "clearwarnings") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target = interaction.options.getMember("user");
            if (!target) return replyErr("User not found.");
            warnHistory.delete(target.id);
            db.clearWarnings(target.id).catch(() => {});
            return reply(`✅ Cleared warnings for ${target}.`);
        }
        if (commandName === "mute") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "Muted by mod";
            if (!target) return replyErr("User not found.");
            await target.timeout(28 * 24 * 60 * 60 * 1000, reason);
            return reply(`🔇 ${target} muted. Reason: **${reason}**`);
        }
        if (commandName === "unmute") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target = interaction.options.getMember("user");
            if (!target) return replyErr("User not found.");
            await target.timeout(null);
            return reply(`🔊 ${target} unmuted.`);
        }
        if (commandName === "purge") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            await interaction.deferReply({ ephemeral: true });
            const n       = interaction.options.getInteger("count");
            const deleted = await interaction.channel.bulkDelete(n, true);
            return reply(`🗑️ Deleted **${deleted.size}** messages.`);
        }
        if (commandName === "slowmode") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const secs = interaction.options.getInteger("seconds");
            await interaction.channel.setRateLimitPerUser(secs);
            return reply(secs === 0 ? "✅ Slowmode off." : `✅ Slowmode set to **${secs}s**.`);
        }
        if (commandName === "lock") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
            return reply("🔒 Channel locked.");
        }
        if (commandName === "unlock") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
            return reply("🔓 Channel unlocked.");
        }
        if (commandName === "closeticket") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            if (!ticketChannels.has(interaction.channelId)) return replyErr("Not a ticket channel.");
            await reply("✅ Closing ticket...");
            await interaction.channel.send("🎫 Ticket closed.").catch(() => {});
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
            ticketChannels.delete(interaction.channelId);
            db.closeTicket(interaction.channelId).catch(() => {});
            return;
        }
        if (commandName === "setnickname") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target   = interaction.options.getMember("user");
            const nickname = interaction.options.getString("nickname") || null;
            if (!target) return replyErr("User not found.");
            await target.setNickname(nickname).catch(e => { throw new Error(`Could not change nickname: ${e.message}`); });
            return reply(nickname ? `✅ Nickname set to **${nickname}**.` : `✅ Nickname reset.`);
        }

        // ---- ADMIN+ ----
        if (commandName === "ban") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "No reason provided";
            if (!target) return replyErr("User not found.");
            await target.send(`🔨 You were **banned** from **${guild.name}**.\nReason: **${reason}**`).catch(() => {});
            await target.ban({ reason });
            return reply({ embeds: [buildActionEmbed("🔨 Member Banned", 0xFF4444, target.user, member.user, reason)] });
        }
        if (commandName === "kick") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "No reason provided";
            if (!target) return replyErr("User not found.");
            await target.send(`👢 You were **kicked** from **${guild.name}**.\nReason: **${reason}**`).catch(() => {});
            await target.kick(reason);
            return reply({ embeds: [buildActionEmbed("👢 Member Kicked", 0xFF8800, target.user, member.user, reason)] });
        }
        if (commandName === "announce") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            await interaction.deferReply({ ephemeral: true });
            const title       = interaction.options.getString("title");
            const description = interaction.options.getString("desc");
            const ytId        = interaction.options.getString("video") ? extractYouTubeId(interaction.options.getString("video")) : null;
            const downloadUrl = interaction.options.getString("download");
            const robloxUrl   = interaction.options.getString("roblox");
            await postAnnouncement(interaction.channel, { title, description, ytId, downloadUrl, robloxUrl }, member.user.tag);
            return reply("✅ Announcement posted!");
        }
        if (commandName === "giveaway") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const timeStr = interaction.options.getString("time");
            const prize   = interaction.options.getString("prize");
            const res     = parseTime(timeStr);
            if (!res) return replyErr("Format: `30s`, `10m`, `1h`");
            await runGiveaway(interaction.channel, res.ms, prize, member.user.tag);
            return reply(`✅ Giveaway started! Drawing in **${timeStr}**.`);
        }
        if (commandName === "setwelcome") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).welcomeMessage = interaction.options.getString("message");
            return reply("✅ Welcome message updated!");
        }
        if (commandName === "setgoodbyemsg") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).goodbyeMessage = interaction.options.getString("message");
            return reply("✅ Goodbye message updated!");
        }
        if (commandName === "setmodrole") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).modRoleId = interaction.options.getRole("role").id;
            return reply(`✅ Mod role set to **${interaction.options.getRole("role").name}**.`);
        }
        if (commandName === "setautorole") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).autoRoleId = interaction.options.getRole("role").id;
            return reply(`✅ Auto-role set to **${interaction.options.getRole("role").name}**.`);
        }
        if (commandName === "setwelcomechannel") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).welcomeChannelId = interaction.options.getChannel("channel").id;
            return reply(`✅ Welcome channel set to ${interaction.options.getChannel("channel")}.`);
        }
        if (commandName === "setgoodbyechannel") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).goodbyeChannelId = interaction.options.getChannel("channel").id;
            return reply(`✅ Goodbye channel set to ${interaction.options.getChannel("channel")}.`);
        }
        if (commandName === "setmodlogchannel") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).modlogChannelId = interaction.options.getChannel("channel").id;
            return reply(`✅ Mod-log set to ${interaction.options.getChannel("channel")}.`);
        }
        if (commandName === "setticketcategory") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const cat = interaction.options.getChannel("category");
            if (cat.type !== ChannelType.GuildCategory) return replyErr("Must be a **Category** channel.");
            getSettings(guild.id).ticketCategoryId = cat.id;
            return reply(`✅ Ticket category set to **${cat.name}**.`);
        }
        if (commandName === "enableai")  { if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher."); aiEnabledChannels.add(interaction.channelId); return reply("✅ AI Chat enabled."); }
        if (commandName === "disableai") { if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher."); aiEnabledChannels.delete(interaction.channelId); return reply("❌ AI Chat disabled."); }
        if (commandName === "addcmd") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const trigger  = interaction.options.getString("trigger").toLowerCase().replace(/^!/, "");
            const response = interaction.options.getString("response");
            const map = customCmds.get(guild.id) || new Map();
            map.set(trigger, response);
            customCmds.set(guild.id, map);
            db.setCustomCommand(guild.id, trigger, response).catch(() => {});
            return reply(`✅ Custom command \`!${trigger}\` added.`);
        }
        if (commandName === "removecmd") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const trigger = interaction.options.getString("trigger").toLowerCase().replace(/^!/, "");
            const map = customCmds.get(guild.id);
            if (!map || !map.has(trigger)) return replyErr(`No command \`!${trigger}\` found.`);
            map.delete(trigger);
            db.removeCustomCommand(guild.id, trigger).catch(() => {});
            return reply(`✅ Removed \`!${trigger}\`.`);
        }
        if (commandName === "listcmds") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const map = customCmds.get(guild.id);
            if (!map || !map.size) return reply("No custom commands set.");
            return reply({ embeds: [new EmbedBuilder().setTitle("📋 Custom Commands").setColor(0x00FFAA).setDescription([...map.entries()].map(([k, v]) => `\`!${k}\` → ${v.slice(0, 50)}`).join("\n"))] });
        }
        if (commandName === "reactionrole") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const msgId = interaction.options.getString("messageid");
            const emoji = interaction.options.getString("emoji");
            const role  = interaction.options.getRole("role");
            reactionRoles.set(`${guild.id}:${msgId}:${emoji}`, role.id);
            db.addReactionRole(guild.id, msgId, emoji, role.id).catch(() => {});
            try { const msg = await interaction.channel.messages.fetch(msgId); await msg.react(emoji); } catch {}
            return reply(`✅ Reaction role set! ${emoji} → **${role.name}**.`);
        }
        if (commandName === "clearxp") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const target = interaction.options.getMember("user");
            if (!target) return replyErr("User not found.");
            xpData.delete(target.id);
            db.clearXP(target.id).catch(() => {});
            return reply(`✅ XP reset for ${target}.`);
        }

        // ---- GAME CATALOG ----
        if (commandName === "addgame") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const title = interaction.options.getString("title");
            const desc  = interaction.options.getString("description");
            const link  = interaction.options.getString("link");
            const image = interaction.options.getString("image");
            if (!db.ready()) return replyErr("Database not configured — set DATABASE_URL to enable the game catalog.");
            await db.addGame(title, desc, link, image, member.user.tag);
            return reply(`✅ **${title}** added to the website catalog.`);
        }
        if (commandName === "removegame") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const title = interaction.options.getString("title");
            if (!db.ready()) return replyErr("Database not configured.");
            const removed = await db.removeGame(title);
            return removed ? reply(`✅ **${title}** removed from the catalog.`) : replyErr(`No game found with title **${title}**.`);
        }
        if (commandName === "listgames") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            if (!db.ready()) return replyErr("Database not configured.");
            const games = await db.listGames();
            if (!games.length) return reply("No games in the catalog yet. Use `/addgame` to add one.");
            const lines = games.map((g, i) => `**${i + 1}.** ${g.title} *(${g.status})* ${g.play_url ? `— [Play](${g.play_url})` : ""}`);
            return reply({ embeds: [new EmbedBuilder().setTitle("🎮 Game Catalog").setColor(0x00FFAA).setDescription(lines.join("\n")).setFooter({ text: "Manage with /addgame and /removegame" })] });
        }

        // ---- OWNER ----
        if (commandName === "scanandclean") {
            if (guild.ownerId !== member.id) return replyErr("Owner only.");
            await interaction.deferReply();
            const count = await doScanAndClean(interaction.channel);
            return reply(`✅ Scan complete. Deleted **${count}** bad message(s).`);
        }
        if (commandName === "testautomod") {
            if (guild.ownerId !== member.id) return replyErr("Owner only.");
            await interaction.deferReply({ ephemeral: true });
            const tests = [
                { text: "sex",                                               expect: "profanity" },
                { text: "I am giving away $2500 to everyone who registers!", expect: "scam phrase" },
                { text: "free-nitro-discord.xyz",                            expect: "scam domain" },
                { text: "withdrawal of $2700 was successfully",              expect: "scam phrase" },
                { text: "launch of my own cryptocurrency casino",            expect: "scam phrase" },
                { text: "congratulations you have won $1000",                expect: "scam phrase" },
            ];
            const results = tests.map(t => {
                const r = quickTextScan(t.text);
                return `${r.flagged ? "✅ CAUGHT" : "❌ MISSED"} — \`${t.text.slice(0, 50)}\` (${t.expect})`;
            });
            return reply(`**Auto-mod test:**\n${results.join("\n")}`);
        }
        if (commandName === "aitest") {
            if (guild.ownerId !== member.id && !requireLevel("admin", permLevel)) return replyErr("Admin or higher.");
            await interaction.deferReply();
            try {
                const result = await callAI("Reply with exactly: AI is working fine!", "Reply with exactly: AI is working fine!", 20);
                return reply(`🤖 **${result.trim()}**\nModel: \`${OPENROUTER_MODEL}\``);
            } catch (e) { return reply(`❌ AI Test FAILED: ${e.message}`); }
        }

    } catch (e) {
        console.error(`Slash error [${commandName}]:`, e);
        const msg = `❌ Error: ${e.message}`;
        try {
            if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
            else await interaction.reply({ content: msg, ephemeral: true });
        } catch {}
    }
});


// ================================================================
//  BUTTON INTERACTION HANDLER
// ================================================================
async function handleButtonInteraction(interaction) {
    const id = interaction.customId;

    if (id.startsWith("build_confirm_") || id.startsWith("build_cancel_")) {
        const iid     = id.replace("build_confirm_", "").replace("build_cancel_", "");
        const pending = pendingBuilds.get(iid);
        if (!pending) return interaction.reply({ content: "❌ Build request expired (5 min). Run `/generate` again.", ephemeral: true });
        if (interaction.user.id !== pending.userId) return interaction.reply({ content: "❌ Only the person who ran /generate can confirm this.", ephemeral: true });
        if (id.startsWith("build_cancel_")) {
            pendingBuilds.delete(iid);
            return interaction.update({ content: "❌ Server build cancelled.", embeds: [], components: [] });
        }
        await interaction.update({ content: "🏗️ **Building your server...** Please wait...", embeds: [], components: [] });
        pendingBuilds.delete(iid);
        try {
            const results = await buildServerFromPlan(pending.plan, interaction.guild);
            const embed = new EmbedBuilder().setTitle("✅ Server Built!").setColor(0x00FFAA)
                .setDescription(`Built from: *${pending.prompt}*`)
                .addFields(
                    { name: "📁 Categories", value: `${results.categories} created`, inline: true },
                    { name: "💬 Channels",   value: `${results.channels} created`,   inline: true },
                    { name: "🎭 Roles",      value: `${results.roles} created`,      inline: true },
                ).setFooter({ text: "Yobest AI Server Builder" }).setTimestamp();
            await interaction.editReply({ content: "", embeds: [embed], components: [] });
        } catch (e) { await interaction.editReply({ content: `❌ Build failed: ${e.message}`, components: [] }); }
        return;
    }

    if (id.startsWith("agent_confirm_") || id.startsWith("agent_cancel_")) {
        const token   = id.replace("agent_confirm_", "").replace("agent_cancel_", "");
        const pending = pendingAgentActions.get(token);
        if (!pending) return interaction.reply({ content: "❌ Confirmation expired. Re-run `/agent`.", ephemeral: true });
        if (interaction.user.id !== pending.userId) return interaction.reply({ content: "❌ Only the person who ran /agent can confirm this.", ephemeral: true });
        if (id.startsWith("agent_cancel_")) {
            pendingAgentActions.delete(token);
            return interaction.update({ content: "❌ Destructive actions cancelled.", embeds: interaction.message.embeds, components: [] });
        }
        await interaction.update({ content: "⏳ Applying confirmed changes...", components: [] });
        pendingAgentActions.delete(token);
        const results = await executeAgentActions(pending.actions, interaction.guild);
        const embed = new EmbedBuilder().setTitle("✅ Confirmed Actions Applied").setColor(0x00FFAA)
            .setDescription(results.length ? results.map(r => `• ${r}`).join("\n") : "Nothing to apply.").setTimestamp();
        await interaction.editReply({ content: "", embeds: [embed] });
        return;
    }

    if (id.startsWith("owner_confirm_") || id.startsWith("owner_cancel_")) {
        const token   = id.replace("owner_confirm_", "").replace("owner_cancel_", "");
        const pending = pendingOwnerActions.get(token);
        if (!pending) return interaction.reply({ content: "❌ Confirmation expired. Re-run `/command`.", ephemeral: true });
        if (interaction.user.id !== pending.userId) return interaction.reply({ content: "❌ Only the server owner can confirm this.", ephemeral: true });
        if (id.startsWith("owner_cancel_")) {
            pendingOwnerActions.delete(token);
            return interaction.update({ content: "❌ Action cancelled.", embeds: interaction.message.embeds, components: [] });
        }
        await interaction.update({ content: "⏳ Executing confirmed action(s)...", components: [] });
        pendingOwnerActions.delete(token);
        const guild   = interaction.guild;
        const channel = guild.channels.cache.get(pending.channelId) || interaction.channel;
        const results = await executeOwnerActions(pending.actions, guild, channel);
        const embed = new EmbedBuilder().setTitle("✅ Owner Command Executed").setColor(0xF1C40F)
            .setDescription(results.length ? results.map(r => `• ${r}`).join("\n") : "Nothing to execute.").setTimestamp();
        await interaction.editReply({ content: "", embeds: [embed] });
        return;
    }

    if (id.startsWith("script_view_")) {
        const scriptId = id.replace("script_view_", "");
        let data = scriptStore.get(scriptId) || await db.getScript(scriptId);
        if (!data) return interaction.reply({ content: "❌ Script data not found — use the download attachment on the announcement post instead.", ephemeral: true });
        const chunks = splitCode(data.script, 1900);
        await interaction.reply({ content: `📜 **Full Script** (${chunks.length} part${chunks.length > 1 ? "s" : ""}):\n\`\`\`${data.lang}\n${chunks[0]}\n\`\`\``, ephemeral: true });
        for (let i = 1; i < chunks.length; i++)
            await interaction.followUp({ content: `\`\`\`${data.lang}\n${chunks[i]}\n\`\`\``, ephemeral: true });
        return;
    }

    if (id.startsWith("script_copy_")) {
        const scriptId = id.replace("script_copy_", "");
        const data = scriptStore.get(scriptId) || await db.getScript(scriptId);
        if (!data) return interaction.reply({ content: "❌ Script data not found.", ephemeral: true });
        const preview = data.script.slice(0, 1800);
        return interaction.reply({
            content: `📋 **Copy the script below** (Ctrl+A → Ctrl+C):\n\`\`\`${data.lang}\n${preview}${data.script.length > 1800 ? "\n...(use 👁️ View Full or ⬇️ Download for the complete script)" : ""}\n\`\`\``,
            ephemeral: true,
        });
    }

    if (id.startsWith("script_download_")) {
        const scriptId = id.replace("script_download_", "");
        const data = scriptStore.get(scriptId) || await db.getScript(scriptId);
        if (!data) return interaction.reply({ content: "❌ Script data not found — use the file attachment on the original announcement post instead.", ephemeral: true });
        const extMap   = { javascript: "js", python: "py", typescript: "ts", txt: "txt" };
        const ext      = extMap[data.lang] || "lua";
        const filename = `${data.title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 40)}.${ext}`;
        return interaction.reply({
            content: `⬇️ **Download: \`${filename}\`**`,
            files:   [new AttachmentBuilder(Buffer.from(data.script, "utf8"), { name: filename })],
            ephemeral: true,
        });
    }

    if (id === "ticket_close_btn") {
        const permLevel = getPermLevel(interaction.member, interaction.guild);
        if (!requireLevel("mod", permLevel)) {
            return interaction.reply({ content: "❌ Only mods+ can close this ticket.", ephemeral: true });
        }
        if (!ticketChannels.has(interaction.channelId)) {
            return interaction.reply({ content: "❌ Not a ticket channel.", ephemeral: true });
        }
        await interaction.reply("🔒 Closing ticket in 3 seconds...");
        ticketChannels.delete(interaction.channelId);
        db.closeTicket(interaction.channelId).catch(() => {});
        setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
        return;
    }
}


// ================================================================
//  POST SCRIPT ANNOUNCEMENT
// ================================================================
async function postScriptAnnouncement(channel, { title, desc, script, lang, ytId, dlLink, authorTag }) {
    const scriptId  = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    scriptStore.set(scriptId, { script, lang, title });
    db.saveScript(scriptId, channel.guild?.id ?? null, channel.id, title, lang, script).catch(() => {});

    const preview   = script.slice(0, 300);
    const hasMore   = script.length > 300;
    const lineCount = script.split("\n").length;

    const embed = new EmbedBuilder()
        .setTitle(`📜 ${title}`).setColor(0x5865F2).setDescription(desc)
        .addFields(
            { name: "🔍 Script Preview", value: `\`\`\`${lang}\n${preview}${hasMore ? "\n\n... full script attached below ↓" : ""}\n\`\`\``, inline: false },
            { name: "📏 Size",     value: `${lineCount} lines · ${script.length.toLocaleString()} chars`, inline: true },
            { name: "💻 Language", value: lang.toUpperCase(), inline: true },
            { name: "👤 Author",   value: authorTag, inline: true },
        )
        .setFooter({ text: `${SITE_INFO.name} • Script Release` }).setTimestamp();

    if (ytId) {
        embed.setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`);
        embed.addFields({ name: "▶️ Video", value: `[Watch on YouTube](https://youtu.be/${ytId})`, inline: true });
    }

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`script_view_${scriptId}`).setLabel("👁️ View Full Script").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`script_copy_${scriptId}`).setLabel("📋 Copy Script").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`script_download_${scriptId}`).setLabel("⬇️ Download Script").setStyle(ButtonStyle.Success),
    );

    const row2 = new ActionRowBuilder();
    if (ytId)   row2.addComponents(new ButtonBuilder().setLabel("▶️ Watch Video").setStyle(ButtonStyle.Link).setURL(`https://youtu.be/${ytId}`));
    if (dlLink) row2.addComponents(new ButtonBuilder().setLabel("🔗 Extra Download").setStyle(ButtonStyle.Link).setURL(dlLink));
    row2.addComponents(new ButtonBuilder().setLabel("🌐 Yobest Studio").setStyle(ButtonStyle.Link).setURL(SITE_INFO.url));

    const components = [row1];
    if (row2.components.length > 0) components.push(row2);

    // Always attach the full script as a downloadable file — no size limit (within Discord's
    // own upload cap), persists in Discord even if the bot restarts and scriptStore is wiped.
    const extMap   = { javascript: "js", python: "py", typescript: "ts", txt: "txt" };
    const ext      = extMap[lang] || "lua";
    const filename = `${title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 40) || "script"}.${ext}`;

    await channel.send({
        content:    "@everyone 📜 **New Script Release!**",
        embeds:     [embed],
        components,
        files:      [new AttachmentBuilder(Buffer.from(script, "utf8"), { name: filename })],
    });
}

// ================================================================
//  AI SERVER BUILDER CORE
// ================================================================
async function generateServerPlan(prompt) {
    const systemPrompt = `You are a Discord server architect. Output a JSON server plan.
IMPORTANT: Reply ONLY with raw valid JSON. No markdown, no backticks, no explanation.
Format:
{
  "serverName": "suggested server name",
  "description": "one sentence about this server",
  "categories": [
    {
      "name": "CATEGORY NAME",
      "channels": [
        { "name": "channel-name", "type": "text", "topic": "channel topic" },
        { "name": "voice-channel", "type": "voice" }
      ]
    }
  ],
  "roles": [
    { "name": "Role Name", "color": "#FF5733" }
  ]
}
Rules:
- Channel names: hyphens instead of spaces. You may include emoji (e.g. "🎮-gaming" or "🔊-music").
- Generate 3-6 categories, 2-5 channels each, 3-8 roles
- Role colors: hex strings`;

    const raw     = await callAI(prompt, systemPrompt, 1500);
    const cleaned = raw.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
    let plan;
    try { plan = JSON.parse(cleaned); }
    catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("AI did not return valid JSON. Try rephrasing your prompt.");
        plan = JSON.parse(match[0]);
    }
    if (!plan.categories || !Array.isArray(plan.categories))
        throw new Error("AI returned an invalid plan structure. Please try again.");
    return plan;
}

function buildServerPlanEmbed(plan, prompt) {
    const catLines = (plan.categories || []).map(cat => {
        const channels = (cat.channels || []).map(ch => `  ${ch.type === "voice" ? "🔊" : "💬"} #${sanitizeChannelName(ch.name)}`).join("\n");
        return `**📁 ${cat.name}**\n${channels}`;
    }).join("\n\n");
    const roleLines = (plan.roles || []).map(r => `🎭 **${r.name}**`).join(" · ");
    return new EmbedBuilder()
        .setTitle(`🏗️ Generated Server: ${plan.serverName || "New Server"}`).setColor(0x5865F2)
        .setDescription(plan.description || `Built from: *${prompt}*`)
        .addFields(
            { name: "📂 Structure", value: catLines.slice(0, 1024) || "None", inline: false },
            { name: "🎭 Roles",     value: roleLines.slice(0, 512) || "None", inline: false },
            { name: "⚠️ Warning",   value: "This will **add** new channels, categories, and roles.\nExisting content will NOT be deleted.", inline: false },
        )
        .setFooter({ text: "Click ✅ Build It to apply · ❌ Cancel to discard" }).setTimestamp();
}

async function buildServerFromPlan(plan, guild) {
    const results = { categories: 0, channels: 0, roles: 0 };
    for (const roleDef of (plan.roles || [])) {
        try {
            const color = roleDef.color ? parseInt(roleDef.color.replace("#", ""), 16) : 0x99AAB5;
            await guild.roles.create({ name: roleDef.name, color: isNaN(color) ? 0x99AAB5 : color, reason: "Yobest AI Server Builder" });
            results.roles++;
        } catch (e) { console.warn(`Could not create role ${roleDef.name}:`, e.message); }
    }
    for (const catDef of (plan.categories || [])) {
        let category;
        try {
            category = await guild.channels.create({ name: catDef.name, type: ChannelType.GuildCategory, reason: "Yobest AI Server Builder" });
            results.categories++;
        } catch (e) { console.warn(`Could not create category ${catDef.name}:`, e.message); continue; }
        for (const chDef of (catDef.channels || [])) {
            try {
                const chType = chDef.type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText;
                const chOpts = { name: sanitizeChannelName(chDef.name), type: chType, parent: category.id, reason: "Yobest AI Server Builder" };
                if (chDef.topic && chType === ChannelType.GuildText) chOpts.topic = chDef.topic;
                await guild.channels.create(chOpts);
                results.channels++;
            } catch (e) { console.warn(`Could not create channel ${chDef.name}:`, e.message); }
        }
    }
    return results;
}


// ================================================================
//  AI SERVER AGENT (FULL PERMISSIONS)
// ================================================================
function buildGuildContext(guild) {
    const channels = [...guild.channels.cache.values()]
        .filter(c => c.type !== ChannelType.GuildCategory).slice(0, 40)
        .map(c => `#${c.name} (${c.type === ChannelType.GuildVoice ? "voice" : "text"}, id:${c.id}${c.parentId ? `, cat:${c.parentId}` : ""})`).join(", ");
    const categories = [...guild.channels.cache.values()]
        .filter(c => c.type === ChannelType.GuildCategory).slice(0, 20)
        .map(c => `"${c.name}" (id:${c.id})`).join(", ");
    const roles = [...guild.roles.cache.values()]
        .filter(r => r.name !== "@everyone").slice(0, 25)
        .map(r => `"${r.name}" (id:${r.id})`).join(", ");
    return { channels, categories, roles, name: guild.name, everyoneId: guild.roles.everyone.id };
}

async function runAgentTurn(ctx, history) {
    const systemPrompt = `You are an AI server manager with FULL Discord permissions for "${ctx.name}".
You can create/rename/delete channels and roles, move channels between categories, set channel
topics/NSFW/slowmode, set per-channel permission overwrites (ACLs) for any role, edit role
color/hoist/mentionable/permissions, and rename the server itself.

@everyone role id: "${ctx.everyoneId}"
Channels: ${ctx.channels || "none"}
Categories: ${ctx.categories || "none"}
Roles: ${ctx.roles || "none"}

Respond ONLY with valid JSON:
{
  "message": "Human-readable explanation of what you're doing",
  "actions": [
    { "type": "rename_channel",        "id": "channel_id", "name": "new-name-with-🎮-emoji-ok" },
    { "type": "delete_channel",        "id": "channel_id" },
    { "type": "create_channel",        "name": "🎮-gaming", "channelType": "text", "category_id": "opt", "topic": "opt" },
    { "type": "move_channel",          "id": "channel_id", "category_id": "cat_id_or_null" },
    { "type": "set_channel_topic",     "id": "channel_id", "topic": "text" },
    { "type": "set_channel_nsfw",      "id": "channel_id", "nsfw": true },
    { "type": "set_channel_slowmode",  "id": "channel_id", "seconds": 10 },
    { "type": "set_channel_permission","id": "channel_id", "role_id": "role_or_everyone_id", "allow": ["ViewChannel","SendMessages"], "deny": ["MentionEveryone"] },
    { "type": "rename_role",           "id": "role_id", "name": "New Name" },
    { "type": "delete_role",           "id": "role_id" },
    { "type": "create_role",           "name": "Role Name", "color": "#FF5733" },
    { "type": "set_role_color",        "id": "role_id", "color": "#FF5733" },
    { "type": "set_role_hoist",        "id": "role_id", "hoist": true },
    { "type": "set_role_mentionable",  "id": "role_id", "mentionable": true },
    { "type": "set_role_permissions",  "id": "role_id", "permissions": ["ManageMessages","KickMembers"] },
    { "type": "create_category",       "name": "CATEGORY NAME" },
    { "type": "rename_server",         "name": "New Server Name" }
  ]
}

Valid permission flag keys: ViewChannel, SendMessages, ManageMessages, ManageChannels, ManageRoles,
KickMembers, BanMembers, ManageGuild, MentionEveryone, AttachFiles, EmbedLinks, Connect, Speak,
MuteMembers, ReadMessageHistory, AddReactions, UseApplicationCommands.

Channel names MAY include emoji — just write them naturally (e.g. "🎉-giveaways").
Use ONLY IDs from the lists above. If no actions needed, use []. Reply ONLY with JSON.`;

    const messages = [{ role: "system", content: systemPrompt }, ...history];
    const raw      = await callAIMessages(messages, 1200);
    const cleaned  = raw.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
    try {
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed.actions)) parsed.actions = [];
        return parsed;
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) { try { const p = JSON.parse(match[0]); if (!Array.isArray(p.actions)) p.actions = []; return p; } catch {} }
        return { message: raw || "I'm not sure how to help with that.", actions: [] };
    }
}

function describeAgentAction(action, guild) {
    switch (action.type) {
        case "delete_channel": { const ch = guild.channels.cache.get(action.id); return `Delete channel ${ch ? "#" + ch.name : action.id}`; }
        case "delete_role":    { const r  = guild.roles.cache.get(action.id);     return `Delete role "${r ? r.name : action.id}"`; }
        default: return action.type;
    }
}

async function executeAgentActions(actions, guild) {
    const results = [];
    for (const action of actions) {
        try {
            switch (action.type) {
                case "rename_channel": {
                    const ch = guild.channels.cache.get(action.id);
                    if (!ch) { results.push(`⚠️ Channel ${action.id} not found`); break; }
                    const old = ch.name;
                    await ch.setName(sanitizeChannelName(action.name));
                    results.push(`Renamed #${old} → #${sanitizeChannelName(action.name)}`);
                    break;
                }
                case "delete_channel": {
                    const ch = guild.channels.cache.get(action.id);
                    if (!ch) { results.push(`⚠️ Channel ${action.id} not found`); break; }
                    const name = ch.name;
                    await ch.delete("AI Agent (confirmed)");
                    results.push(`Deleted #${name}`);
                    break;
                }
                case "create_channel": {
                    const chName = sanitizeChannelName(action.name || "new-channel");
                    const chType = action.channelType === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText;
                    const opts   = { name: chName, type: chType, reason: "AI Agent" };
                    if (action.category_id) opts.parent = action.category_id;
                    if (action.topic && chType === ChannelType.GuildText) opts.topic = action.topic;
                    await guild.channels.create(opts);
                    results.push(`Created ${action.channelType || "text"} channel #${chName}`);
                    break;
                }
                case "move_channel": {
                    const ch = guild.channels.cache.get(action.id);
                    if (!ch) { results.push(`⚠️ Channel ${action.id} not found`); break; }
                    await ch.setParent(action.category_id || null, { lockPermissions: false });
                    results.push(`Moved #${ch.name} → ${action.category_id ? "new category" : "no category"}`);
                    break;
                }
                case "set_channel_topic": {
                    const ch = guild.channels.cache.get(action.id);
                    if (!ch) { results.push(`⚠️ Channel ${action.id} not found`); break; }
                    await ch.setTopic(action.topic || "");
                    results.push(`Set topic on #${ch.name}`);
                    break;
                }
                case "set_channel_nsfw": {
                    const ch = guild.channels.cache.get(action.id);
                    if (!ch) { results.push(`⚠️ Channel ${action.id} not found`); break; }
                    await ch.setNSFW(!!action.nsfw);
                    results.push(`Set NSFW on #${ch.name}: ${!!action.nsfw}`);
                    break;
                }
                case "set_channel_slowmode": {
                    const ch = guild.channels.cache.get(action.id);
                    if (!ch) { results.push(`⚠️ Channel ${action.id} not found`); break; }
                    await ch.setRateLimitPerUser(Math.max(0, Math.min(21600, action.seconds || 0)));
                    results.push(`Slowmode on #${ch.name}: ${action.seconds || 0}s`);
                    break;
                }
                case "set_channel_permission": {
                    const ch = guild.channels.cache.get(action.id);
                    if (!ch) { results.push(`⚠️ Channel ${action.id} not found`); break; }
                    const roleId = action.role_id || guild.roles.everyone.id;
                    const overwriteObj = buildPermissionOverwriteObject(action.allow || [], action.deny || []);
                    if (!Object.keys(overwriteObj).length) { results.push(`⚠️ No valid permission keys for #${ch.name}`); break; }
                    await ch.permissionOverwrites.edit(roleId, overwriteObj, { reason: "AI Agent" });
                    const target = roleId === guild.roles.everyone.id ? "@everyone" : (guild.roles.cache.get(roleId)?.name || roleId);
                    results.push(`Set permissions on #${ch.name} for **${target}**`);
                    break;
                }
                case "rename_role": {
                    const role = guild.roles.cache.get(action.id);
                    if (!role) { results.push(`⚠️ Role ${action.id} not found`); break; }
                    const old = role.name;
                    await role.setName(action.name);
                    results.push(`Renamed role "${old}" → "${action.name}"`);
                    break;
                }
                case "delete_role": {
                    const role = guild.roles.cache.get(action.id);
                    if (!role) { results.push(`⚠️ Role ${action.id} not found`); break; }
                    const name = role.name;
                    await role.delete("AI Agent (confirmed)");
                    results.push(`Deleted role "${name}"`);
                    break;
                }
                case "create_role": {
                    const color = action.color ? parseInt(action.color.replace("#", ""), 16) : 0x99AAB5;
                    await guild.roles.create({ name: action.name || "New Role", color: isNaN(color) ? 0x99AAB5 : color, reason: "AI Agent" });
                    results.push(`Created role "${action.name}"`);
                    break;
                }
                case "set_role_color": {
                    const role = guild.roles.cache.get(action.id);
                    if (!role) { results.push(`⚠️ Role ${action.id} not found`); break; }
                    const color = parseInt((action.color || "#99AAB5").replace("#", ""), 16);
                    await role.setColor(isNaN(color) ? 0x99AAB5 : color);
                    results.push(`Set color of "${role.name}" to ${action.color}`);
                    break;
                }
                case "set_role_hoist": {
                    const role = guild.roles.cache.get(action.id);
                    if (!role) { results.push(`⚠️ Role ${action.id} not found`); break; }
                    await role.setHoist(!!action.hoist);
                    results.push(`Set "${role.name}" hoist: ${!!action.hoist}`);
                    break;
                }
                case "set_role_mentionable": {
                    const role = guild.roles.cache.get(action.id);
                    if (!role) { results.push(`⚠️ Role ${action.id} not found`); break; }
                    await role.setMentionable(!!action.mentionable);
                    results.push(`Set "${role.name}" mentionable: ${!!action.mentionable}`);
                    break;
                }
                case "set_role_permissions": {
                    const role = guild.roles.cache.get(action.id);
                    if (!role) { results.push(`⚠️ Role ${action.id} not found`); break; }
                    const perms = buildPermissionsBitfieldArray(action.permissions || []);
                    if (!perms.length) { results.push(`⚠️ No valid permission keys for role "${role.name}"`); break; }
                    await role.setPermissions(perms.map(p => PermissionFlagsBits[p]));
                    results.push(`Set permissions on "${role.name}": ${perms.join(", ")}`);
                    break;
                }
                case "create_category": {
                    await guild.channels.create({ name: (action.name || "New Category").toUpperCase(), type: ChannelType.GuildCategory, reason: "AI Agent" });
                    results.push(`Created category "${action.name}"`);
                    break;
                }
                case "rename_server": {
                    const old = guild.name;
                    await guild.setName(action.name);
                    results.push(`Renamed server: "${old}" → "${action.name}"`);
                    break;
                }
                default: results.push(`⚠️ Unknown action: ${action.type}`);
            }
        } catch (e) { results.push(`❌ Failed [${action.type}]: ${e.message}`); }
    }
    return results;
}


// ================================================================
//  OWNER NATURAL LANGUAGE CONTROL (/command)
// ================================================================
function buildOwnerContext(guild) {
    const members = [...guild.members.cache.values()].filter(m => !m.user.bot).slice(0, 80)
        .map(m => `${m.user.username} (id:${m.id}${m.nickname ? `, nick:${m.nickname}` : ""})`).join(", ");
    const channels = [...guild.channels.cache.values()].filter(c => c.type !== ChannelType.GuildCategory).slice(0, 40)
        .map(c => `#${c.name} (id:${c.id})`).join(", ");
    const roles = [...guild.roles.cache.values()].filter(r => r.name !== "@everyone").slice(0, 25)
        .map(r => `"${r.name}" (id:${r.id})`).join(", ");
    return { members, channels, roles, name: guild.name };
}

async function runOwnerCommandTurn(instruction, guild) {
    const ctx = buildOwnerContext(guild);
    const systemPrompt = `You are the server owner's personal assistant for "${ctx.name}".
Resolve free-form instructions into structured actions. Match member names/mentions to IDs below.

Members: ${ctx.members || "none"}
Channels: ${ctx.channels || "none"}
Roles: ${ctx.roles || "none"}

Respond ONLY with valid JSON:
{
  "message": "What I understood and will do",
  "actions": [
    { "type": "ban",            "user_id": "id", "reason": "text" },
    { "type": "kick",           "user_id": "id", "reason": "text" },
    { "type": "timeout",        "user_id": "id", "minutes": 10, "reason": "text" },
    { "type": "warn",           "user_id": "id", "reason": "text" },
    { "type": "purge",          "channel_id": "id", "count": 20 },
    { "type": "add_role",       "user_id": "id", "role_id": "id" },
    { "type": "remove_role",    "user_id": "id", "role_id": "id" },
    { "type": "set_nickname",   "user_id": "id", "nickname": "text or null to reset" },
    { "type": "rename_channel", "channel_id": "id", "name": "new-name" },
    { "type": "delete_channel", "channel_id": "id" },
    { "type": "delete_role",    "role_id": "id" },
    { "type": "send_message",   "channel_id": "id", "text": "message text" }
  ]
}

If you cannot confidently match a name to a real ID from above, set actions:[] and explain in message.
Never invent IDs. Reply ONLY with JSON.`;

    const raw     = await callAIMessages([{ role: "system", content: systemPrompt }, { role: "user", content: instruction }], 800);
    const cleaned = raw.replace(/```(?:json)?\n?/g, "").replace(/```/g, "").trim();
    try { const p = JSON.parse(cleaned); if (!Array.isArray(p.actions)) p.actions = []; return p; }
    catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (match) { try { const p = JSON.parse(match[0]); if (!Array.isArray(p.actions)) p.actions = []; return p; } catch {} }
        return { message: raw || "Could not understand that instruction.", actions: [] };
    }
}

function describeOwnerAction(action, guild) {
    const userTag  = (id) => guild.members.cache.get(id)?.user.tag || id;
    const chName   = (id) => guild.channels.cache.get(id)?.name || id;
    const roleName = (id) => guild.roles.cache.get(id)?.name || id;
    switch (action.type) {
        case "ban":            return `Ban ${userTag(action.user_id)} — ${action.reason || "no reason"}`;
        case "kick":           return `Kick ${userTag(action.user_id)} — ${action.reason || "no reason"}`;
        case "timeout":        return `Timeout ${userTag(action.user_id)} for ${action.minutes || 10}m — ${action.reason || "no reason"}`;
        case "purge":          return `Delete ${action.count || 0} messages in #${chName(action.channel_id)}`;
        case "delete_channel": return `Delete channel #${chName(action.channel_id)}`;
        case "delete_role":    return `Delete role "${roleName(action.role_id)}"`;
        default: return action.type;
    }
}

async function executeOwnerActions(actions, guild, channel) {
    const results = [];
    for (const action of actions) {
        try {
            switch (action.type) {
                case "ban": {
                    const member = await guild.members.fetch(action.user_id).catch(() => null);
                    if (!member) { results.push(`⚠️ Member ${action.user_id} not found`); break; }
                    const reason = action.reason || "Banned via owner /command";
                    await member.send(`🔨 You were **banned** from **${guild.name}**.\nReason: **${reason}**`).catch(() => {});
                    await member.ban({ reason });
                    results.push(`Banned ${member.user.tag} — ${reason}`);
                    break;
                }
                case "kick": {
                    const member = await guild.members.fetch(action.user_id).catch(() => null);
                    if (!member) { results.push(`⚠️ Member ${action.user_id} not found`); break; }
                    const reason = action.reason || "Kicked via owner /command";
                    await member.send(`👢 You were **kicked** from **${guild.name}**.\nReason: **${reason}**`).catch(() => {});
                    await member.kick(reason);
                    results.push(`Kicked ${member.user.tag} — ${reason}`);
                    break;
                }
                case "timeout": {
                    const member = await guild.members.fetch(action.user_id).catch(() => null);
                    if (!member) { results.push(`⚠️ Member ${action.user_id} not found`); break; }
                    const ms = Math.max(1, Math.min(40320, action.minutes || 10)) * 60_000;
                    await member.timeout(ms, action.reason || "Timed out via /command");
                    results.push(`Timed out ${member.user.tag} for ${action.minutes || 10}m`);
                    break;
                }
                case "warn": {
                    const member = await guild.members.fetch(action.user_id).catch(() => null);
                    if (!member) { results.push(`⚠️ Member ${action.user_id} not found`); break; }
                    const reason = action.reason || "Warned via /command";
                    const warns  = addWarning(member.id, reason, "Server Owner");
                    await member.send(`⚠️ You were **warned** in **${guild.name}**.\nReason: **${reason}**`).catch(() => {});
                    results.push(`Warned ${member.user.tag} (#${warns.length}) — ${reason}`);
                    break;
                }
                case "purge": {
                    const ch = guild.channels.cache.get(action.channel_id) || channel;
                    if (!ch?.bulkDelete) { results.push(`⚠️ Channel ${action.channel_id} not found`); break; }
                    const n = Math.max(1, Math.min(100, action.count || 10));
                    const deleted = await ch.bulkDelete(n, true);
                    results.push(`Deleted ${deleted.size} messages in #${ch.name}`);
                    break;
                }
                case "add_role": {
                    const member = await guild.members.fetch(action.user_id).catch(() => null);
                    const role   = guild.roles.cache.get(action.role_id);
                    if (!member || !role) { results.push(`⚠️ Member or role not found`); break; }
                    await member.roles.add(role);
                    results.push(`Gave "${role.name}" to ${member.user.tag}`);
                    break;
                }
                case "remove_role": {
                    const member = await guild.members.fetch(action.user_id).catch(() => null);
                    const role   = guild.roles.cache.get(action.role_id);
                    if (!member || !role) { results.push(`⚠️ Member or role not found`); break; }
                    await member.roles.remove(role);
                    results.push(`Removed "${role.name}" from ${member.user.tag}`);
                    break;
                }
                case "set_nickname": {
                    const member = await guild.members.fetch(action.user_id).catch(() => null);
                    if (!member) { results.push(`⚠️ Member ${action.user_id} not found`); break; }
                    await member.setNickname(action.nickname || null);
                    results.push(`Set nickname of ${member.user.tag} to ${action.nickname || "(reset)"}`);
                    break;
                }
                case "rename_channel": {
                    const ch = guild.channels.cache.get(action.channel_id);
                    if (!ch) { results.push(`⚠️ Channel ${action.channel_id} not found`); break; }
                    const old = ch.name;
                    await ch.setName(sanitizeChannelName(action.name));
                    results.push(`Renamed #${old} → #${sanitizeChannelName(action.name)}`);
                    break;
                }
                case "delete_channel": {
                    const ch = guild.channels.cache.get(action.channel_id);
                    if (!ch) { results.push(`⚠️ Channel ${action.channel_id} not found`); break; }
                    const name = ch.name;
                    await ch.delete("Owner /command (confirmed)");
                    results.push(`Deleted #${name}`);
                    break;
                }
                case "delete_role": {
                    const role = guild.roles.cache.get(action.role_id);
                    if (!role) { results.push(`⚠️ Role ${action.role_id} not found`); break; }
                    const name = role.name;
                    await role.delete("Owner /command (confirmed)");
                    results.push(`Deleted role "${name}"`);
                    break;
                }
                case "send_message": {
                    const ch = guild.channels.cache.get(action.channel_id) || channel;
                    if (!ch?.send) { results.push(`⚠️ Channel ${action.channel_id} not found`); break; }
                    await ch.send(action.text || "");
                    results.push(`Sent message in #${ch.name}`);
                    break;
                }
                default: results.push(`⚠️ Unknown action: ${action.type}`);
            }
        } catch (e) { results.push(`❌ Failed [${action.type}]: ${e.message}`); }
    }
    return results;
}


// ================================================================
//  MESSAGE HANDLER (prefix commands + auto-mod + XP + AI chat)
// ================================================================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content   = message.content.trim();
    const lower     = content.toLowerCase();
    const permLevel = getPermLevel(message.member, message.guild);
    const isMod     = requireLevel("mod",   permLevel);
    const isAdmin   = requireLevel("admin", permLevel);
    const isOwner   = permLevel === "owner";
    const guildId   = message.guild.id;

    // ── STEP 1 — AUTO-MOD ──
    if (!isMod) {
        const spamResult = checkSpam(message.author.id);
        if (spamResult.flagged) {
            await safeDelete(message);
            await applyTimeout(message, "Anti-spam: too many messages", "spam", null);
            return;
        }

        const instantResult = quickTextScan(content);
        if (instantResult.flagged) {
            await safeDelete(message);
            await message.author.send(
                `⚠️ **Your message in ${message.guild.name} was removed.**\n` +
                `**Reason:** ${instantResult.reason}\n\nContact a moderator if this was a mistake.`
            ).catch(() => {});
            await applyTimeout(message, instantResult.reason, instantResult.category, null);
            return;
        }

        for (const embed of message.embeds) {
            const r = scanEmbedText(embed);
            if (r.flagged) {
                await safeDelete(message);
                await message.author.send(`⚠️ **Your message in ${message.guild.name} was removed.**\n**Reason:** ${r.reason}`).catch(() => {});
                await applyTimeout(message, r.reason, r.category, null);
                return;
            }
        }

        for (const f of getFileAttachments(message)) {
            if (DANGEROUS_EXTS.test(f.name)) {
                await safeDelete(message);
                await applyTimeout(message, `Dangerous file blocked: \`${f.name}\``, "file", null);
                return;
            }
        }

        moderateWithAI(message).catch(() => {});
        if (/https?:\/\//i.test(content)) scheduleEmbedRecheck(message);
    }

    // ── STEP 2 — XP ──
    if (!ticketChannels.has(message.channelId)) {
        const result = addXP(message.author.id, XP_PER_MSG(), {
            username:  message.author.tag,
            avatarURL: message.author.displayAvatarURL({ dynamic: true }),
        });
        if (result.leveled) {
            message.channel.send(`🎉 ${message.author} leveled up to **Level ${result.level}**! ⭐`).catch(() => {});
        }
    }

    // ── STEP 3 — PREFIX COMMANDS ──

    // OWNER
    if (isOwner) {
        if (lower === "!scanandclean") {
            const r = await message.reply("🔍 Scanning...");
            const n = await doScanAndClean(message.channel);
            return r.edit(`✅ Deleted **${n}** bad message(s).`);
        }
        if (lower === "!aitest") {
            try {
                const res = await callAI("Say: AI is working fine!", "Reply exactly: AI is working fine!", 20);
                return message.reply(`🤖 **${res.trim()}** | Model: \`${OPENROUTER_MODEL}\``);
            } catch (e) { return message.reply(`❌ AI FAILED: ${e.message}`); }
        }
    }

    // ADMIN
    if (isAdmin) {
        if (lower === "!help")      return message.reply({ embeds: [buildHelpEmbed(permLevel)] });
        if (lower === "!enableai")  { aiEnabledChannels.add(message.channel.id); return message.reply("✅ AI enabled."); }
        if (lower === "!disableai") { aiEnabledChannels.delete(message.channel.id); return message.reply("❌ AI disabled."); }
        if (lower.startsWith("!announce")) return handleAnnouncePrefix(message, content);
        if (lower.startsWith("!setwelcome "))       { getSettings(guildId).welcomeMessage = content.split(" ").slice(1).join(" "); return message.reply("✅ Welcome message updated!"); }
        if (lower.startsWith("!setgoodbyemsg "))    { getSettings(guildId).goodbyeMessage = content.split(" ").slice(1).join(" "); return message.reply("✅ Goodbye message updated!"); }
        if (lower.startsWith("!setmodrole "))       { const r = message.mentions.roles?.first(); if (!r) return message.reply("❌ Mention a role."); getSettings(guildId).modRoleId = r.id; return message.reply(`✅ Mod role: **${r.name}**.`); }
        if (lower.startsWith("!setautorole "))      { const r = message.mentions.roles?.first(); if (!r) return message.reply("❌ Mention a role."); getSettings(guildId).autoRoleId = r.id; return message.reply(`✅ Auto-role: **${r.name}**.`); }
        if (lower.startsWith("!setwelcomechannel")) { const c = message.mentions.channels?.first(); if (!c) return message.reply("❌ Mention a channel."); getSettings(guildId).welcomeChannelId = c.id; return message.reply(`✅ Welcome: ${c}.`); }
        if (lower.startsWith("!setgoodbyechannel")) { const c = message.mentions.channels?.first(); if (!c) return message.reply("❌ Mention a channel."); getSettings(guildId).goodbyeChannelId = c.id; return message.reply(`✅ Goodbye: ${c}.`); }
        if (lower.startsWith("!setmodlogchannel"))  { const c = message.mentions.channels?.first(); if (!c) return message.reply("❌ Mention a channel."); getSettings(guildId).modlogChannelId = c.id; return message.reply(`✅ Mod-log: ${c}.`); }
        if (lower.startsWith("!ban "))              return handleBanPrefix(message, content, "ban");
        if (lower.startsWith("!kick "))             return handleBanPrefix(message, content, "kick");
        if (lower.startsWith("!giveaway "))         return handleGiveawayPrefix(message, content);
        if (lower.startsWith("!addcmd ")) {
            const parts = content.split(" ").slice(1);
            const trigger = parts[0]?.toLowerCase().replace(/^!/, "");
            const response = parts.slice(1).join(" ");
            if (!trigger || !response) return message.reply("❌ Usage: `!addcmd trigger response`");
            const map = customCmds.get(guildId) || new Map();
            map.set(trigger, response);
            customCmds.set(guildId, map);
            db.setCustomCommand(guildId, trigger, response).catch(() => {});
            return message.reply(`✅ \`!${trigger}\` added.`);
        }
        if (lower.startsWith("!removecmd ")) {
            const trigger = content.split(" ")[1]?.toLowerCase().replace(/^!/, "");
            const map = customCmds.get(guildId);
            if (!map || !map.has(trigger)) return message.reply(`❌ No \`!${trigger}\`.`);
            map.delete(trigger);
            db.removeCustomCommand(guildId, trigger).catch(() => {});
            return message.reply(`✅ Removed \`!${trigger}\`.`);
        }
        if (lower === "!listcmds") {
            const map = customCmds.get(guildId);
            if (!map || !map.size) return message.reply("No custom commands.");
            return message.reply({ embeds: [new EmbedBuilder().setTitle("📋 Custom Commands").setColor(0x00FFAA).setDescription([...map.entries()].map(([k, v]) => `\`!${k}\` → ${v.slice(0, 50)}`).join("\n"))] });
        }
    }

    // MOD+
    if (isMod) {
        if (lower.startsWith("!warn ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user.");
            const reason = content.replace(/^!warn\s+<@!?\d+>\s*/i, "").trim() || "No reason";
            const warns  = addWarning(target.id, reason, message.author.tag, guildId);
            await target.send(`⚠️ Warned in **${message.guild.name}**.\nReason: **${reason}**\nWarning #${warns.length}`).catch(() => {});
            return message.reply(`⚠️ ${target} warned (${warns.length} total).`);
        }
        if (lower.startsWith("!warnings "))      { const t = message.mentions.members?.first(); if (!t) return message.reply("❌ Mention a user."); const w = warnHistory.get(t.id) || []; if (!w.length) return message.reply("✅ No warnings."); return message.reply({ embeds: [buildWarningsEmbed(t.user, w)] }); }
        if (lower.startsWith("!clearwarnings ")) { const t = message.mentions.members?.first(); if (!t) return message.reply("❌ Mention a user."); warnHistory.delete(t.id); db.clearWarnings(t.id).catch(() => {}); return message.reply("✅ Cleared."); }
        if (lower.startsWith("!mute "))          { const t = message.mentions.members?.first(); if (!t) return message.reply("❌ Mention a user."); const r = content.replace(/^!mute\s+<@!?\d+>\s*/i, "").trim() || "Muted"; await t.timeout(28*24*60*60*1000, r); return message.reply(`🔇 ${t} muted.`); }
        if (lower.startsWith("!unmute "))        { const t = message.mentions.members?.first(); if (!t) return message.reply("❌ Mention a user."); await t.timeout(null); return message.reply(`🔊 ${t} unmuted.`); }
        if (lower.startsWith("!purge ")) {
            const n = parseInt(content.split(" ")[1]);
            if (isNaN(n) || n < 1 || n > 100) return message.reply("❌ 1-100");
            await safeDelete(message);
            const d = await message.channel.bulkDelete(n, true);
            const note = await message.channel.send(`🗑️ Deleted **${d.size}** messages.`);
            setTimeout(() => note.delete().catch(() => {}), 4000);
            return;
        }
        if (lower.startsWith("!slowmode ")) { const s = parseInt(content.split(" ")[1]); if (isNaN(s) || s < 0 || s > 21600) return message.reply("❌ 0-21600"); await message.channel.setRateLimitPerUser(s); return message.reply(s === 0 ? "✅ Slowmode off." : `✅ Slowmode: ${s}s.`); }
        if (lower === "!lock")         { await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }); return message.reply("🔒 Locked."); }
        if (lower === "!unlock")       { await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });  return message.reply("🔓 Unlocked."); }
        if (lower === "!closeticket")  { if (!ticketChannels.has(message.channelId)) return message.reply("❌ Not a ticket channel."); await message.reply("✅ Closing..."); setTimeout(() => message.channel.delete().catch(() => {}), 3000); ticketChannels.delete(message.channelId); db.closeTicket(message.channelId).catch(() => {}); return; }
    }

    // PUBLIC PREFIX
    if (lower === "!ping")        { const s = await message.reply("🏓 Pinging..."); return s.edit(`🏓 Pong! **${s.createdTimestamp - message.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`); }
    if (lower === "!stats")       return message.reply({ embeds: [buildStatsEmbed(message.guild)] });
    if (lower === "!serverinfo")  return message.reply({ embeds: [buildServerInfoEmbed(message.guild)] });
    if (lower === "!botinfo")     return message.reply({ embeds: [buildBotInfoEmbed()] });
    if (lower === "!help")        return message.reply({ embeds: [buildHelpEmbed(permLevel)] });
    if (lower === "!coinflip")    return message.reply(Math.random() < 0.5 ? "🪙 Heads!" : "🟡 Tails!");
    if (lower === "!quote")       { const q = QUOTES[Math.floor(Math.random() * QUOTES.length)]; return message.reply({ embeds: [new EmbedBuilder().setTitle("💬 Quote").setColor(0x00FFAA).setDescription(`*"${q.text}"*\n\n— **${q.author}**`)] }); }
    if (lower === "!snipe")       { const d = snipeData.get(message.channelId); if (!d) return message.reply("🎯 Nothing to snipe."); return message.reply({ embeds: [new EmbedBuilder().setTitle("🎯 Sniped").setColor(0xFF8800).setDescription(d.content.slice(0, 2000)).setAuthor({ name: d.author, iconURL: d.avatarURL || undefined }).setTimestamp(d.timestamp)] }); }
    if (lower === "!rank")        { const d = xpData.get(message.author.id) || { xp: 0, level: 0 }; const n = XP_FOR_LEVEL(d.level + 1); return message.reply({ embeds: [new EmbedBuilder().setColor(0x00FFAA).setTitle(`⭐ ${message.author.tag}'s Rank`).setThumbnail(message.author.displayAvatarURL({ dynamic: true })).addFields({ name: "Level", value: `**${d.level}**`, inline: true }, { name: "XP", value: `**${d.xp}/${n}**`, inline: true }).setDescription(buildXPBar(d.xp, n)).setTimestamp()] }); }
    if (lower === "!leaderboard") return message.reply({ embeds: [buildLeaderboard(message.guild)] });
    if (lower === "!ticket")      return await handleTicketPrefix(message);
    if (lower === "!site")        return message.reply({ embeds: [buildSiteEmbed()], components: [buildSiteRow()] });
    if (lower === "!discord")     return message.reply("🔗 **Join:** https://discord.gg/yobest");
    if (lower === "!userinfo" || lower.startsWith("!userinfo "))   { const t = message.mentions.members?.first() || message.member; return message.reply({ embeds: [buildUserInfoEmbed(t, message.guild)] }); }
    if (lower === "!avatar"   || lower.startsWith("!avatar "))     { const t = message.mentions.users?.first() || message.author;   return message.reply({ embeds: [new EmbedBuilder().setTitle(`🖼️ ${t.tag}`).setColor(0x00FFAA).setImage(t.displayAvatarURL({ dynamic: true, size: 1024 }))] }); }
    if (lower.startsWith("!roll")) {
        const arg = content.split(" ")[1] || "1d6";
        const m   = arg.match(/^(\d+)d(\d+)$/i);
        if (!m) return message.reply("❌ Usage: `!roll 2d6`");
        const count = Math.min(parseInt(m[1]), 100);
        const sides = Math.min(parseInt(m[2]), 1000);
        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
        return message.reply(`🎲 **${count}d${sides}**: [${rolls.join(", ")}] → **${rolls.reduce((a, b) => a + b, 0)}**`);
    }
    if (lower.startsWith("!8ball ")) {
        const q = content.split(" ").slice(1).join(" ");
        const a = ["Yes, definitely.","It is certain.","Without a doubt.","Most likely.","Probably not.","Don't count on it.","My sources say no.","Ask again later.","Absolutely not.","Signs point to yes."];
        return message.reply({ embeds: [new EmbedBuilder().setTitle("🎱 Magic 8-Ball").setColor(0x00FFAA).addFields({ name: "❓", value: q }, { name: "💬", value: a[Math.floor(Math.random() * a.length)] })] });
    }
    if (lower.startsWith("!suggest ")) {
        const s = content.split(" ").slice(1).join(" ");
        if (!s) return message.reply("❌ Add idea text.");
        const sent = await message.channel.send({ embeds: [new EmbedBuilder().setTitle("💡 Suggestion").setColor(0x00FFAA).setDescription(s).setFooter({ text: `By ${message.author.tag}` }).setTimestamp()] });
        await sent.react("👍").catch(() => {});
        await sent.react("👎").catch(() => {});
        return safeDelete(message);
    }
    if (lower.startsWith("!poll "))     return handlePollPrefix(message, content);
    if (lower.startsWith("!report "))   return handleReportPrefix(message, content);
    if (lower.startsWith("!remindme ")) return handleRemindMePrefix(message, content);
    if (lower.startsWith("!math ")) {
        const expr = content.split(" ").slice(1).join(" ");
        try {
            const safe = expr.replace(/[^0-9+\-*/().%\s]/g, "");
            // eslint-disable-next-line no-new-func
            const r = Function(`"use strict"; return (${safe})`)();
            if (typeof r !== "number" || !isFinite(r)) return message.reply("❌ Invalid.");
            return message.reply(`🧮 \`${safe}\` = **${r}**`);
        } catch { return message.reply("❌ Could not evaluate."); }
    }
    if (lower.startsWith("!rps ")) {
        const choices = ["rock","paper","scissors"];
        const emojis  = { rock: "🪨", paper: "📄", scissors: "✂️" };
        const up      = content.split(" ")[1]?.toLowerCase();
        if (!choices.includes(up)) return message.reply("❌ rock/paper/scissors");
        const bp = choices[Math.floor(Math.random() * 3)];
        let out  = "🤝 Tie!";
        if ((up==="rock"&&bp==="scissors")||(up==="paper"&&bp==="rock")||(up==="scissors"&&bp==="paper")) out = "🎉 You win!";
        else if (up !== bp) out = "😞 Bot wins!";
        return message.reply(`You: **${emojis[up]} ${up}** vs Bot: **${emojis[bp]} ${bp}**\n${out}`);
    }

    // Custom commands
    const cmdMap = customCmds.get(guildId);
    if (cmdMap && lower.startsWith("!")) {
        const trigger = lower.slice(1).split(" ")[0];
        if (cmdMap.has(trigger)) return message.reply(cmdMap.get(trigger));
    }

    // AI Chat
    if (aiEnabledChannels.has(message.channel.id)) {
        const triggers = ["yobest","bot","script","code","site","website","hello","hi","help","roblox","lua"];
        if (message.mentions.has(client.user) || triggers.some(t => lower.includes(t))) {
            const thinking = await message.reply("🤔 **Yobest is thinking...**");
            const response = await getAIResponse(message);
            await thinking.delete().catch(() => {});
            if (response) await sendAIResponse(message, response);
        }
    }
});


// ================================================================
//  AUTO-MOD HELPERS
// ================================================================
async function safeDelete(message) {
    try { await message.delete(); } catch (e) { if (e.code !== 10008) console.error("safeDelete:", e.code, e.message); }
}

function checkSpam(userId) {
    const now  = Date.now();
    const data = spamTracker.get(userId) || { count: 0, resetAt: now + SPAM_WINDOW_MS };
    if (now > data.resetAt) { data.count = 1; data.resetAt = now + SPAM_WINDOW_MS; }
    else data.count++;
    spamTracker.set(userId, data);
    return { flagged: data.count > SPAM_LIMIT };
}

function quickTextScan(text) {
    if (!text) return { flagged: false };
    for (const p of PROFANITY_PATTERNS) if (p.test(text)) return { flagged: true, reason: "Inappropriate language detected", category: "language", evidenceUrl: null };
    for (const p of SCAM_PHRASES)       if (p.test(text)) return { flagged: true, reason: "Scam/fraud content detected",       category: "scam",     evidenceUrl: null };
    for (const p of SCAM_DOMAINS)       if (p.test(text)) return { flagged: true, reason: "Scam/phishing domain detected",     category: "scam",     evidenceUrl: null };
    return { flagged: false };
}

function scanEmbedText(embed) {
    const parts = [
        embed.title, embed.description, embed.url,
        embed.author?.name, embed.author?.url, embed.footer?.text,
        ...(embed.fields || []).map(f => `${f.name} ${f.value}`),
    ].filter(Boolean).join(" ");
    return quickTextScan(parts);
}

function getImageUrls(message) {
    const urls = [];
    for (const a of message.attachments.values()) {
        if (a.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url)) urls.push(a.url);
    }
    for (const e of message.embeds) {
        if (e.image?.url)     urls.push(e.image.url);
        if (e.thumbnail?.url) urls.push(e.thumbnail.url);
    }
    return [...new Set(urls)];
}

function getFileAttachments(message) {
    return [...message.attachments.values()].filter(a => {
        const isImg = a.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url);
        return !isImg;
    });
}

async function moderateWithAI(message) {
    if (!openaiClient) return;
    try {
        const text      = message.content || "";
        const imageUrls = getImageUrls(message);
        const checks    = [];
        if (text.trim())              checks.push(classifyTextWithAI(text));
        for (const url of imageUrls)  checks.push(classifyImageWithAI(url));
        if (!checks.length) return;
        const results = await Promise.allSettled(checks);
        for (const r of results) {
            if (r.status === "fulfilled" && r.value?.flagged) {
                const exists = await message.channel.messages.fetch(message.id).catch(() => null);
                if (!exists) return;
                await safeDelete(message);
                await message.author.send(`⚠️ **Your message in ${message.guild.name} was removed.**\n**Reason:** ${r.value.reason}`).catch(() => {});
                await applyTimeout(message, r.value.reason, r.value.category, r.value.evidenceUrl);
                return;
            }
        }
    } catch {}
}

const recheckInProgress = new Set();
function scheduleEmbedRecheck(message) {
    setTimeout(async () => {
        if (recheckInProgress.has(message.id)) return;
        recheckInProgress.add(message.id);
        try {
            const fresh = await message.channel.messages.fetch(message.id).catch(() => null);
            if (!fresh || !fresh.embeds.length) return;
            for (const embed of fresh.embeds) {
                const r = scanEmbedText(embed);
                if (r.flagged) {
                    await safeDelete(fresh);
                    await fresh.author.send(`⚠️ **Your message in ${fresh.guild.name} was removed.**\n**Reason:** ${r.reason} (link preview)`).catch(() => {});
                    await applyTimeout(fresh, r.reason, r.category, null);
                    return;
                }
            }
            if (!openaiClient) return;
            const imageUrls = getImageUrls(fresh);
            if (!imageUrls.length) return;
            const results = await Promise.allSettled(imageUrls.map(url => classifyImageWithAI(url)));
            for (const r of results) {
                if (r.status === "fulfilled" && r.value?.flagged) {
                    await safeDelete(fresh);
                    await fresh.author.send(`⚠️ **Your message in ${fresh.guild.name} was removed.**\n**Reason:** ${r.value.reason}`).catch(() => {});
                    await applyTimeout(fresh, r.value.reason, r.value.category, r.value.evidenceUrl);
                    return;
                }
            }
        } catch {} finally { recheckInProgress.delete(message.id); }
    }, 2000);
}

// ================================================================
//  AI WRAPPERS
// ================================================================
async function callAI(userPrompt, systemPrompt = "You are a helpful assistant.", maxTok = 50) {
    if (!openaiClient) throw new Error("No AI configured. Set OPENROUTER_API_KEY.");
    const models = [OPENROUTER_MODEL, OPENROUTER_FALLBACK];
    for (const model of models) {
        try {
            const res  = await openaiClient.chat.completions.create({
                model,
                messages:    [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
                max_tokens:  maxTok,
                temperature: 0,
            });
            const text = res?.choices?.[0]?.message?.content;
            if (text) { if (model !== OPENROUTER_MODEL) console.log(`ℹ️  Fallback model used: ${model}`); return text; }
        } catch (e) {
            console.warn(`⚠️  callAI [${model}]: ${e?.message}`);
            if (model === models[models.length - 1]) throw e;
        }
    }
    return "";
}

async function callAIMessages(messages, maxTok = 400) {
    if (!openaiClient) throw new Error("No AI configured. Set OPENROUTER_API_KEY.");
    const models = [OPENROUTER_MODEL, OPENROUTER_FALLBACK];
    for (const model of models) {
        try {
            const res  = await openaiClient.chat.completions.create({ model, messages, max_tokens: maxTok, temperature: 0.3 });
            const text = res?.choices?.[0]?.message?.content;
            if (text) return text;
        } catch (e) {
            console.warn(`⚠️  callAIMessages [${model}]: ${e?.message}`);
            if (model === models[models.length - 1]) throw e;
        }
    }
    return "";
}

async function callAIWithImage(textPrompt, imageUrl) {
    if (!openaiClient) return "";
    try {
        const res  = await openaiClient.chat.completions.create({
            model:       OPENROUTER_VISION,
            messages:    [{ role: "user", content: [{ type: "text", text: textPrompt }, { type: "image_url", image_url: { url: imageUrl, detail: "low" } }] }],
            max_tokens:  20,
            temperature: 0,
        });
        return res?.choices?.[0]?.message?.content || "";
    } catch (e) { console.error("callAIWithImage:", e?.message); return ""; }
}

async function classifyTextWithAI(text) {
    if (!openaiClient) return { flagged: false };
    try {
        const p = `Classify this Discord message with ONE WORD: TOXIC, SCAM, PHISHING, or SAFE.\n\nMessage: "${text.slice(0, 500)}"\n\nOne word:`;
        const r = await callAI(p, "You are a content moderator. Reply one word only.", 10);
        const cat = (r || "").toUpperCase().trim().split(/\s+/)[0];
        if (cat === "TOXIC")    return { flagged: true, reason: "Toxic content detected",    category: "toxic",    evidenceUrl: null };
        if (cat === "SCAM")     return { flagged: true, reason: "Scam content detected",     category: "scam",     evidenceUrl: null };
        if (cat === "PHISHING") return { flagged: true, reason: "Phishing content detected", category: "phishing", evidenceUrl: null };
        return { flagged: false };
    } catch { return { flagged: false }; }
}

async function classifyImageWithAI(url) {
    if (!openaiClient) return { flagged: false };
    try {
        const p = "Classify this image with ONE WORD: SCAM, PHISHING, NSFW, or SAFE. One word:";
        const r = await callAIWithImage(p, url);
        const cat = (r || "").toUpperCase().trim().split(/\s+/)[0];
        if (cat === "SCAM")     return { flagged: true, reason: "Scam image detected",    category: "scam",     evidenceUrl: url };
        if (cat === "PHISHING") return { flagged: true, reason: "Phishing image detected", category: "phishing", evidenceUrl: url };
        if (cat === "NSFW")     return { flagged: true, reason: "NSFW image detected",     category: "nsfw",     evidenceUrl: url };
        return { flagged: false };
    } catch { return { flagged: false }; }
}

async function getAIResponse(message) {
    if (!openaiClient) return "⚠️ AI is not configured — set `OPENROUTER_API_KEY`.";
    const userInput    = message.content.replace(/<@!?[0-9]+>/g, "").trim() || "Hello";
    const systemPrompt =
        `You are ${AI_DISPLAY_NAME}, a friendly Roblox Lua scripting expert and Discord bot for ${SITE_INFO.name}.\n` +
        `About the site: ${SITE_INFO.description}\n\n` +
        `Rules: Respond in English. For Lua/Roblox scripts write complete code in a \`\`\`lua block. ` +
        `For site questions refer to ${SITE_INFO.url}. Keep replies concise and friendly.`;
    const models = [OPENROUTER_MODEL, OPENROUTER_FALLBACK];
    for (const model of models) {
        try {
            const c    = await openaiClient.chat.completions.create({ model, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userInput }], max_tokens: 600, temperature: 0.7 });
            const text = c?.choices?.[0]?.message?.content;
            if (text) return text;
        } catch (e) {
            const msg = e?.message || String(e);
            if (msg.includes("402") || msg.includes("credits")) return "⚠️ AI ran out of credits. Top up at https://openrouter.ai/settings/credits";
            if (msg.includes("401") || msg.includes("Unauthorized")) return "⚠️ Invalid API key. Check `OPENROUTER_API_KEY`.";
            if (msg.includes("429")) return "⚠️ Too many requests — please wait a moment.";
            if (model === models[models.length - 1]) return `⚠️ AI unavailable: ${msg.slice(0, 100)}`;
        }
    }
    return "⚠️ AI could not generate a response. Please try again.";
}


// ================================================================
//  WARN ESCALATION + MOD-LOG
// ================================================================
async function logToModChannel(guild, embed) {
    try {
        const s  = getSettings(guild.id);
        const id = s.modlogChannelId || MODLOG_CHANNEL_ID;
        if (!id) return;
        const ch = guild.channels.cache.get(id);
        if (!ch?.send) return;
        await ch.send({ embeds: [embed] }).catch(() => {});
    } catch {}
}

/**
 * Escalating auto-mod punishment:
 *   1st violation → warning only
 *   2nd violation → 10 minute timeout
 *   3rd violation → 1 hour timeout
 *   4th+ violation → 24 hour timeout
 * Also records a warning entry and posts a log embed to the mod-log channel.
 */
async function applyTimeout(message, reason, category, evidenceUrl) {
    try {
        const userId = message.author.id;
        const guild  = message.guild;
        const count  = (violationCount.get(userId) || 0) + 1;
        violationCount.set(userId, count);

        const warns = addWarning(userId, `[Auto-mod: ${category}] ${reason}`, "AutoMod");

        let action = "Warned";
        let member = null;
        try { member = await guild.members.fetch(userId); } catch {}

        if (count >= 2 && member) {
            const ms =
                count === 2 ? 10 * 60_000 :
                count === 3 ? 60 * 60_000 :
                24 * 60 * 60_000;
            try {
                await member.timeout(ms, `Auto-mod (${category}): ${reason}`);
                action = `Timed out for ${formatUptime(ms)}`;
            } catch {
                action = "Warned (timeout failed — check role hierarchy)";
            }
        }

        const embed = new EmbedBuilder()
            .setTitle("🛡️ Auto-Mod Action")
            .setColor(0xFF4444)
            .addFields(
                { name: "User",       value: `${message.author.tag} (${userId})`, inline: true },
                { name: "Category",   value: `\`${category}\``, inline: true },
                { name: "Violation #", value: `${count}`, inline: true },
                { name: "Action",     value: action, inline: true },
                { name: "Reason",     value: reason.slice(0, 1000), inline: false },
                { name: "Channel",    value: `${message.channel}`, inline: true },
                { name: "Warnings on file", value: `${warns.length}`, inline: true },
            )
            .setTimestamp();
        if (evidenceUrl) embed.setImage(evidenceUrl);

        await logToModChannel(guild, embed);
    } catch (e) { console.error("applyTimeout error:", e.message); }
}

// ================================================================
//  /scanandclean — bulk-scan recent channel history
// ================================================================
async function doScanAndClean(channel) {
    let deleted = 0;
    try {
        const fetched  = await channel.messages.fetch({ limit: 100 });
        const messages = [...fetched.values()].filter(m => !m.author.bot);

        for (const msg of messages) {
            let flagged = false;
            let reason  = "";

            const textResult = quickTextScan(msg.content || "");
            if (textResult.flagged) { flagged = true; reason = textResult.reason; }

            if (!flagged) {
                for (const embed of msg.embeds) {
                    const r = scanEmbedText(embed);
                    if (r.flagged) { flagged = true; reason = r.reason; break; }
                }
            }

            if (!flagged && openaiClient) {
                const imageUrls = getImageUrls(msg);
                for (const url of imageUrls) {
                    const r = await classifyImageWithAI(url).catch(() => ({ flagged: false }));
                    if (r.flagged) { flagged = true; reason = r.reason; break; }
                }
            }

            if (flagged) {
                await msg.delete().catch(() => {});
                deleted++;
                violationCount.set(msg.author.id, (violationCount.get(msg.author.id) || 0) + 1);
                addWarning(msg.author.id, `[ScanAndClean] ${reason}`, "AutoMod");
            }
        }

        if (deleted > 0) {
            await logToModChannel(channel.guild, new EmbedBuilder()
                .setTitle("🧹 Scan & Clean Complete")
                .setColor(0xFF8800)
                .addFields(
                    { name: "Channel",         value: `${channel}`, inline: true },
                    { name: "Messages Scanned", value: `${messages.length}`, inline: true },
                    { name: "Messages Deleted", value: `${deleted}`, inline: true },
                )
                .setTimestamp());
        }
    } catch (e) { console.error("doScanAndClean error:", e.message); }
    return deleted;
}

// ================================================================
//  ANNOUNCE
// ================================================================
async function postAnnouncement(channel, { title, description, ytId, downloadUrl, robloxUrl }, authorTag) {
    const embed = new EmbedBuilder()
        .setTitle(`📢 ${title}`)
        .setColor(0x00FFAA)
        .setDescription(description)
        .setFooter({ text: `Announced by ${authorTag}` })
        .setTimestamp();
    if (ytId) embed.setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`);

    const row = new ActionRowBuilder();
    if (downloadUrl) row.addComponents(new ButtonBuilder().setLabel("⬇️ Download").setStyle(ButtonStyle.Link).setURL(extractUrl(downloadUrl)));
    if (robloxUrl)   row.addComponents(new ButtonBuilder().setLabel("🎮 Play on Roblox").setStyle(ButtonStyle.Link).setURL(extractUrl(robloxUrl)));
    if (ytId)         row.addComponents(new ButtonBuilder().setLabel("▶️ Watch Video").setStyle(ButtonStyle.Link).setURL(`https://youtu.be/${ytId}`));

    const payload = { embeds: [embed] };
    if (row.components.length) payload.components = [row];
    await channel.send(payload);
}

async function handleAnnouncePrefix(message, content) {
    // Usage: !announce Title | Description | [youtube url] | [download url] | [roblox url]
    const body = content.replace(/^!announce\s*/i, "");
    const parts = body.split("|").map(s => s.trim());
    const [title, description, video, download, roblox] = parts;
    if (!title || !description) {
        return message.reply("❌ Usage: `!announce Title | Description | [video] | [download] | [roblox]`");
    }
    const ytId = video ? extractYouTubeId(video) : null;
    await postAnnouncement(message.channel, { title, description, ytId, downloadUrl: download, robloxUrl: roblox }, message.author.tag);
    return safeDelete(message);
}

// ================================================================
//  GIVEAWAY
// ================================================================
async function runGiveaway(channel, ms, prize, hostTag) {
    const endsAt = Date.now() + ms;
    const embed = new EmbedBuilder()
        .setTitle("🎉 GIVEAWAY 🎉")
        .setColor(0xFFD700)
        .setDescription(`**Prize:** ${prize}\n\nReact with 🎉 to enter!\nEnds: <t:${Math.floor(endsAt / 1000)}:R>`)
        .setFooter({ text: `Hosted by ${hostTag}` })
        .setTimestamp();
    const sent = await channel.send({ embeds: [embed] });
    await sent.react("🎉").catch(() => {});

    setTimeout(async () => {
        try {
            const fresh   = await channel.messages.fetch(sent.id).catch(() => null);
            if (!fresh) return;
            const reaction = fresh.reactions.cache.get("🎉");
            const users    = reaction ? [...(await reaction.users.fetch()).values()].filter(u => !u.bot) : [];

            if (!users.length) {
                return channel.send({ embeds: [new EmbedBuilder().setTitle("🎉 Giveaway Ended").setColor(0xFFD700).setDescription(`**Prize:** ${prize}\n\nNo valid entries — no winner.`)] });
            }
            const winner = users[Math.floor(Math.random() * users.length)];
            await channel.send({ embeds: [new EmbedBuilder().setTitle("🎉 Giveaway Ended").setColor(0xFFD700).setDescription(`**Prize:** ${prize}\n**Winner:** ${winner}\n\nCongratulations! 🎊`)] });
            await winner.send(`🎉 You won **${prize}** in **${channel.guild.name}**! Congrats!`).catch(() => {});
        } catch (e) { console.error("Giveaway draw error:", e.message); }
    }, ms);
}

async function handleGiveawayPrefix(message, content) {
    // Usage: !giveaway <time> <prize>
    const parts   = content.split(" ").slice(1);
    const timeStr = parts[0];
    const prize   = parts.slice(1).join(" ");
    const res     = parseTime(timeStr);
    if (!res || !prize) return message.reply("❌ Usage: `!giveaway 10m Discord Nitro`");
    await runGiveaway(message.channel, res.ms, prize, message.author.tag);
    return safeDelete(message);
}

// ================================================================
//  POLL
// ================================================================
async function handlePollPrefix(message, content) {
    // Usage: !poll Question? | Option1 | Option2 | ...
    const body  = content.replace(/^!poll\s*/i, "");
    const parts = body.split("|").map(s => s.trim()).filter(Boolean);
    const question = parts[0];
    const opts      = parts.slice(1);
    if (!question || opts.length < 2) return message.reply("❌ Usage: `!poll Question | Option1 | Option2`");
    const nums  = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${question}`)
        .setColor(0x00FFAA)
        .setDescription(opts.slice(0, 9).map((o, i) => `${nums[i]} ${o}`).join("\n"))
        .setFooter({ text: `Poll by ${message.author.tag}` })
        .setTimestamp();
    const sent = await message.channel.send({ embeds: [embed] });
    for (let i = 0; i < Math.min(opts.length, 9); i++) await sent.react(nums[i]).catch(() => {});
    return safeDelete(message);
}

// ================================================================
//  REPORT
// ================================================================
async function handleReportCore(source, target, reason, guild) {
    const s = getSettings(guild.id);
    const logId = s.modlogChannelId || MODLOG_CHANNEL_ID;
    const embed = new EmbedBuilder()
        .setTitle("🚨 New Report")
        .setColor(0xFF4444)
        .addFields(
            { name: "Reported User", value: `${target}`, inline: true },
            { name: "Reported By",   value: `${source.author}`, inline: true },
            { name: "Channel",       value: source.channel ? `${source.channel}` : "Unknown", inline: true },
            { name: "Reason",        value: reason || "No reason provided", inline: false },
        )
        .setTimestamp();

    let posted = false;
    if (logId) {
        const ch = guild.channels.cache.get(logId);
        if (ch?.send) { await ch.send({ embeds: [embed] }).catch(() => {}); posted = true; }
    }
    if (!posted && source.channel?.send) {
        await source.channel.send({ content: "🚨 A report was filed (no mod-log channel configured — visible here):", embeds: [embed] }).catch(() => {});
    }
}

async function handleReportPrefix(message, content) {
    // Usage: !report @user reason text
    const target = message.mentions.members?.first();
    if (!target) return message.reply("❌ Mention the user you're reporting.");
    const reason = content.replace(/^!report\s+<@!?\d+>\s*/i, "").trim() || "No reason provided";
    await handleReportCore({ author: message.author, channel: message.channel }, target, reason, message.guild);
    await safeDelete(message);
    return message.author.send("✅ Your report has been sent to the moderators.").catch(() => {});
}

// ================================================================
//  REMINDME
// ================================================================
async function handleRemindMePrefix(message, content) {
    // Usage: !remindme <time> <text>
    const parts   = content.split(" ").slice(1);
    const timeStr = parts[0];
    const text    = parts.slice(1).join(" ");
    const res     = parseTime(timeStr);
    if (!res || !text) return message.reply("❌ Usage: `!remindme 30m Check the oven`");
    if (res.ms > 24 * 3_600_000) return message.reply("❌ Max reminder time is 24 hours.");
    await message.reply(`⏰ Got it! Reminding you in **${timeStr}**.`);
    setTimeout(async () => {
        await message.author.send(`⏰ **Reminder!**\n${text}\n\n*(Set in ${message.guild.name})*`).catch(async () => {
            await message.channel.send(`${message.author} ⏰ Reminder: **${text}**`).catch(() => {});
        });
    }, res.ms);
}

// ================================================================
//  BAN / KICK (prefix)
// ================================================================
async function handleBanPrefix(message, content, type) {
    const target = message.mentions.members?.first();
    if (!target) return message.reply(`❌ Mention a user to ${type}.`);
    const verb   = type === "ban" ? "!ban" : "!kick";
    const reason = content.replace(new RegExp(`^${verb}\\s+<@!?\\d+>\\s*`, "i"), "").trim() || "No reason provided";

    await target.send(`${type === "ban" ? "🔨" : "👢"} You were **${type === "ban" ? "banned" : "kicked"}** from **${message.guild.name}**.\nReason: **${reason}**`).catch(() => {});
    try {
        if (type === "ban") await target.ban({ reason });
        else await target.kick(reason);
    } catch (e) {
        return message.reply(`❌ Could not ${type}: ${e.message}`);
    }

    return message.reply({
        embeds: [buildActionEmbed(
            type === "ban" ? "🔨 Member Banned" : "👢 Member Kicked",
            type === "ban" ? 0xFF4444 : 0xFF8800,
            target.user, message.author, reason,
        )],
    });
}

// ================================================================
//  TICKETS
// ================================================================
async function createTicketChannel(guild, requester) {
    const s = getSettings(guild.id);
    const overwrites = [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
        { id: requester.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
    ];
    if (s.modRoleId) overwrites.push({ id: s.modRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    const ch = await guild.channels.create({
        name: sanitizeChannelName(`ticket-${requester.user.username}`),
        type: ChannelType.GuildText,
        parent: s.ticketCategoryId || undefined,
        permissionOverwrites: overwrites,
        topic: `Support ticket for ${requester.user.tag} (${requester.id})`,
    });
    ticketChannels.add(ch.id);
    db.openTicket(ch.id, guild.id, requester.id).catch(() => {});

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close_btn").setLabel("🔒 Close Ticket").setStyle(ButtonStyle.Danger),
    );
    await ch.send({
        content: `${requester} Welcome to your ticket! A staff member will be with you shortly.`,
        embeds: [new EmbedBuilder().setTitle("🎫 Support Ticket").setColor(0x00FFAA).setDescription("Describe your issue and a moderator will help. Use `!closeticket` or `/closeticket` (mods) to close this when resolved.").setTimestamp()],
        components: [closeRow],
    });
    return ch;
}

async function handleTicketPrefix(message) {
    const existing = [...message.guild.channels.cache.values()].find(
        c => ticketChannels.has(c.id) && c.topic?.includes(`(${message.author.id})`)
    );
    if (existing) return message.reply(`❌ You already have an open ticket: ${existing}`);
    try {
        const ch = await createTicketChannel(message.guild, message.member);
        return message.reply(`✅ Ticket created: ${ch}`);
    } catch (e) { return message.reply(`❌ Could not create ticket: ${e.message}`); }
}

async function handleTicketSlash(interaction, member, guild, reply, replyErr) {
    const existing = [...guild.channels.cache.values()].find(
        c => ticketChannels.has(c.id) && c.topic?.includes(`(${member.id})`)
    );
    if (existing) return replyErr(`You already have an open ticket: ${existing}`);
    try {
        const ch = await createTicketChannel(guild, member);
        return reply(`✅ Ticket created: ${ch}`, true);
    } catch (e) { return replyErr(`Could not create ticket: ${e.message}`); }
}

// ================================================================
//  EMBED BUILDERS
// ================================================================
function buildStatsEmbed(guild) {
    const mem = process.memoryUsage();
    return new EmbedBuilder()
        .setTitle("📊 Bot & Server Stats")
        .setColor(0x00FFAA)
        .addFields(
            { name: "🏓 Ping",        value: `${Math.round(client.ws.ping)}ms`, inline: true },
            { name: "⏱️ Uptime",      value: formatUptime(Date.now() - startTime), inline: true },
            { name: "💾 Memory",      value: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`, inline: true },
            { name: "🌐 Servers",     value: `${client.guilds.cache.size}`, inline: true },
            { name: "👥 Members",     value: `${guild?.memberCount ?? "?"}`, inline: true },
            { name: "📦 Version",     value: "v4.7", inline: true },
        )
        .setFooter({ text: `${SITE_INFO.name}` })
        .setTimestamp();
}

function buildBotInfoEmbed() {
    return new EmbedBuilder()
        .setTitle(`🤖 ${client.user.username}`)
        .setColor(0x00FFAA)
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "Version",     value: "v4.7", inline: true },
            { name: "Library",     value: "discord.js", inline: true },
            { name: "Node.js",     value: process.version, inline: true },
            { name: "Uptime",      value: formatUptime(Date.now() - startTime), inline: true },
            { name: "Servers",     value: `${client.guilds.cache.size}`, inline: true },
            { name: "AI Model",    value: `\`${OPENROUTER_MODEL}\``, inline: true },
            { name: "Features",    value: "Auto-mod, AI chat, AI Server Builder/Agent, Owner /command, XP, tickets, giveaways, reaction roles", inline: false },
        )
        .setFooter({ text: SITE_INFO.name })
        .setTimestamp();
}

function buildServerInfoEmbed(guild) {
    const owner = guild.members.cache.get(guild.ownerId);
    return new EmbedBuilder()
        .setTitle(`🏠 ${guild.name}`)
        .setColor(0x00FFAA)
        .setThumbnail(guild.iconURL({ dynamic: true }) || null)
        .addFields(
            { name: "Owner",        value: owner ? `${owner.user.tag}` : guild.ownerId, inline: true },
            { name: "Members",      value: `${guild.memberCount}`, inline: true },
            { name: "Created",      value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
            { name: "Channels",     value: `${guild.channels.cache.size}`, inline: true },
            { name: "Roles",        value: `${guild.roles.cache.size}`, inline: true },
            { name: "Boost Level",  value: `${guild.premiumTier ?? 0} (${guild.premiumSubscriptionCount ?? 0} boosts)`, inline: true },
        )
        .setFooter({ text: `ID: ${guild.id}` })
        .setTimestamp();
}

function buildUserInfoEmbed(member, guild) {
    const roles = member.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => r.toString()).slice(0, 15);
    return new EmbedBuilder()
        .setTitle(`👤 ${member.user.tag}`)
        .setColor(member.displayHexColor && member.displayHexColor !== "#000000" ? member.displayHexColor : 0x00FFAA)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "Joined Server", value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Unknown", inline: true },
            { name: "Account Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: "Top Role",     value: member.roles.highest.id !== guild.id ? `${member.roles.highest}` : "None", inline: true },
            { name: `Roles [${roles.length}]`, value: roles.length ? roles.join(" ") : "None", inline: false },
        )
        .setFooter({ text: `ID: ${member.id}` })
        .setTimestamp();
}

function buildWarningsEmbed(user, warns) {
    const lines = warns.slice(-15).map((w, i) => `**#${i + 1}** — ${w.reason}\n*by ${w.by} • <t:${Math.floor(w.ts / 1000)}:R>*`);
    return new EmbedBuilder()
        .setTitle(`⚠️ Warnings for ${user.tag}`)
        .setColor(0xFF8800)
        .setDescription(lines.join("\n\n") || "No warnings.")
        .setFooter({ text: `Total: ${warns.length}` })
        .setTimestamp();
}

function buildActionEmbed(title, color, target, by, reason) {
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setThumbnail(target.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "User",      value: `${target.tag} (${target.id})`, inline: true },
            { name: "Moderator", value: by.tag, inline: true },
            { name: "Reason",    value: reason, inline: false },
        )
        .setTimestamp();
}

function buildSiteEmbed() {
    const embed = new EmbedBuilder()
        .setTitle(`🌐 ${SITE_INFO.name}`)
        .setColor(0x00FFAA)
        .setDescription(SITE_INFO.description)
        .addFields({ name: "✨ Highlights", value: SITE_INFO.highlights.map(h => `• ${h}`).join("\n"), inline: false })
        .setURL(SITE_INFO.url)
        .setFooter({ text: SITE_INFO.url })
        .setTimestamp();
    return embed;
}

function buildSiteRow() {
    const row = new ActionRowBuilder();
    for (const [label, url] of Object.entries(SITE_INFO.links)) {
        row.addComponents(new ButtonBuilder().setLabel(`🌐 ${label}`).setStyle(ButtonStyle.Link).setURL(url));
    }
    return row;
}

function buildLeaderboard(guild) {
    const entries = [...xpData.entries()]
        .filter(([id]) => guild.members.cache.has(id))
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 10);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = entries.map(([id, d], i) => {
        const member = guild.members.cache.get(id);
        const tag    = member ? member.user.tag : id;
        return `${medals[i] || `**#${i + 1}**`} ${tag} — Level **${d.level}** (${d.xp} XP)`;
    });
    return new EmbedBuilder()
        .setTitle(`⭐ ${guild.name} — XP Leaderboard`)
        .setColor(0xFFD700)
        .setDescription(lines.join("\n") || "No XP data yet — start chatting!")
        .setTimestamp();
}

function buildHelpEmbed(permLevel) {
    const embed = new EmbedBuilder()
        .setTitle("📖 Yobest Bot — Command List")
        .setColor(0x00FFAA)
        .setDescription("Use `/` slash commands or the `!` prefix shown below. Items marked with a tier are restricted.")
        .addFields({
            name: "🌐 Public",
            value: "`/ping` `/stats` `/serverinfo` `/botinfo` `/userinfo` `/avatar` `/roll` `/coinflip` `/rps` `/8ball` `/quote` `/math` `/suggest` `/poll` `/report` `/remindme` `/site` `/discord` `/rank` `/leaderboard` `/ticket` `/snipe` `/help`",
            inline: false,
        });

    if (requireLevel("mod", permLevel)) {
        embed.addFields({
            name: "🛡️ Mod+",
            value: "`/warn` `/warnings` `/clearwarnings` `/mute` `/unmute` `/purge` `/slowmode` `/lock` `/unlock` `/closeticket` `/setnickname`",
            inline: false,
        });
    }
    if (requireLevel("admin", permLevel)) {
        embed.addFields({
            name: "👑 Admin+",
            value: "`/ban` `/kick` `/announce` `/giveaway` `/announcescript` `/generate` `/agent` `/agentclear` `/setwelcome` `/setgoodbyemsg` `/setmodrole` `/setautorole` `/setwelcomechannel` `/setgoodbyechannel` `/setmodlogchannel` `/setticketcategory` `/enableai` `/disableai` `/addcmd` `/removecmd` `/listcmds` `/reactionrole` `/clearxp`",
            inline: false,
        });
    }
    if (permLevel === "owner") {
        embed.addFields({
            name: "🔑 Owner Only",
            value: "`/command` — plain-language control (confirm-gated for destructive actions)\n`/scanandclean` `/testautomod` `/aitest`",
            inline: false,
        });
    }
    embed.setFooter({ text: "Prefix commands mirror most slash commands, e.g. !ping, !help" }).setTimestamp();
    return embed;
}

// ================================================================
//  AI CHAT RESPONSE SENDER
// ================================================================
async function sendPlainText(message, text) {
    if (text.length <= 2000) return message.channel.send(text);
    const chunks = splitCode(text, 1900);
    for (const chunk of chunks) await message.channel.send(chunk);
}

async function sendAIResponse(message, response) {
    try {
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        let lastIndex = 0;
        let match;
        let any = false;

        while ((match = codeBlockRegex.exec(response)) !== null) {
            any = true;
            const before = response.slice(lastIndex, match.index).trim();
            if (before) await sendPlainText(message, before);

            const lang  = match[1] || "lua";
            const code  = match[2];
            const chunks = splitCode(code, 1900);
            for (const chunk of chunks) {
                await message.channel.send(`\`\`\`${lang}\n${chunk}\n\`\`\``);
            }
            lastIndex = codeBlockRegex.lastIndex;
        }

        const after = response.slice(lastIndex).trim();
        if (after || !any) await sendPlainText(message, after || response);
    } catch (e) {
        console.error("sendAIResponse error:", e.message);
        await message.channel.send("⚠️ Had trouble formatting that reply — please try again.").catch(() => {});
    }
}

// ================================================================
//  LOGIN
// ================================================================
client.login(process.env.DISCORD_TOKEN);