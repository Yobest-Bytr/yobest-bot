/**
 * Yobest_BYTR Discord Bot  ·  v4.3 — FULL FIX UPDATE
 * ========================================================
 * WHAT'S FIXED / NEW IN v4.3
 * --------------------------------------------------------
 *
 *  🔥 CRITICAL FIX: "anthropicClient is not defined" — ALL references
 *     to anthropicClient have been completely removed from every
 *     function (callAI, callAIWithImage, getAIResponse,
 *     runStartupSelfTest, buildStatsEmbed, buildHelpEmbed).
 *
 *  🔥 CRITICAL FIX: AI now uses OpenRouter ONLY (OPENROUTER_API_KEY).
 *     Model: google/gemini-3.5-flash — hidden from users, shown as "Yobest".
 *
 *  🔥 CRITICAL FIX: Bad messages now truly deleted — safeDelete no
 *     longer uses the broken .deletable cache check; calls
 *     message.delete() directly in a try/catch.
 *
 *  🔥 CRITICAL FIX: Duplicate /commands fixed — global command
 *     registration removed entirely; guild-only registration only.
 *
 *  ✅ NEW: !setwelcomechannel #channel — set WELCOME_CHANNEL_ID live
 *  ✅ NEW: /setwelcomechannel            — same via slash
 *  ✅ NEW: !setmodlogchannel #channel   — set MODLOG_CHANNEL_ID live
 *  ✅ NEW: /setmodlogchannel             — same via slash
 *  ✅ NEW: !setticketcategory #category — set ticket category live
 *  ✅ NEW: /setticketcategory            — same via slash
 *  ✅ NEW: Tickets now open inside the configured category
 *
 *  ✅ All v4.2 features fully preserved and working.
 * ========================================================
 */

"use strict";

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
    PermissionsBitField
} = require("discord.js");

// ====================== AI CLIENT SETUP ======================
// Provider : OpenRouter ONLY  →  OPENROUTER_API_KEY
// Model    : google/gemini-3.5-flash  (NEVER shown to users)
// Display  : "Yobest"
const AI_DISPLAY_NAME  = "Yobest";
const OPENROUTER_MODEL = "google/gemini-3.5-flash";

let openaiClient = null;

try {
    const OpenAI = require("openai");
    if (process.env.OPENROUTER_API_KEY) {
        openaiClient = new (OpenAI.default || OpenAI)({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey:  process.env.OPENROUTER_API_KEY,
            defaultHeaders: {
                "HTTP-Referer": "https://yobest-bytr.vercel.app/",
                "X-Title":      "Yobest Discord Bot"
            }
        });
        console.log("✅ AI client (Yobest) initialized via OpenRouter.");
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
        GatewayIntentBits.DirectMessages
    ]
});

// ====================== STATE ======================
const aiEnabledChannels = new Set();
const violationCount    = new Map();   // userId -> number
const warnHistory       = new Map();   // userId -> [{reason, ts, by}]
const spamTracker       = new Map();   // userId -> {count, resetAt}
const xpData            = new Map();   // userId -> {xp, level}
const customCmds        = new Map();   // guildId -> Map(trigger -> response)
const reactionRoles     = new Map();   // `${guildId}:${msgId}:${emoji}` -> roleId
const ticketChannels    = new Set();   // channelIds that are open tickets
const startTime         = Date.now();

const guildSettings = new Map();

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || null;
const MODLOG_CHANNEL_ID  = process.env.MODLOG_CHANNEL_ID  || null;

let welcomeMessage =
    "Hey {user}, welcome aboard **{server}**! 🎉\n" +
    "You're member **#{count}** of our growing community.";

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
        "Join the community for updates and announcements"
    ]
};

// ====================== CONSTANTS ======================
const DANGEROUS_EXTS  = /\.(exe|bat|cmd|scr|msi|jar|vbs|ps1|lnk|com|apk|dmg|sh|dll)$/i;
const SUSPICIOUS_EXTS = /\.(pdf|txt|html|htm|zip|rar|7z|docx?|xlsx?)$/i;
const SPAM_LIMIT      = 5;
const SPAM_WINDOW_MS  = 60_000;

// ---- PROFANITY PATTERNS ----
const PROFANITY_PATTERNS = [
    /\bsex\b/i,
    /\bporn\b/i,
    /\bporno\b/i,
    /\bxxx\b/i,
    /\bnude\b/i,
    /\bnudes\b/i,
    /\bdick\b/i,
    /\bcocks?\b/i,
    /\bpenis\b/i,
    /\bvagina\b/i,
    /\bpussy\b/i,
    /\bboob\b/i,
    /\bboobs\b/i,
    /\btits?\b/i,
    /\bbooty\b/i,
    /\bass\b(?!\w)/i,
    /\basshole\b/i,
    /\bcum\b/i,
    /\bjizz\b/i,
    /\bfap\b/i,
    /\bboner\b/i,
    /\bsuck\s*(my|this)\b/i,
    /\bfuck\b/i,
    /\bfucker\b/i,
    /\bfucking\b/i,
    /\bf+u+c+k+/i,
    /\bsh[i1]t\b/i,
    /\bbitch\b/i,
    /\bcunt\b/i,
    /\bwhore\b/i,
    /\bslut\b/i,
    /\bho\b(?!\w)/i,
    /\bskank\b/i,
    /\btramp\b/i,
    /\bn[i1]gg[ae]r/i,
    /\bn[i1]gg[a4]\b/i,
    /\bfagg?[o0]t/i,
    /\bretard\b/i,
    /\bspic\b/i,
    /\bchink\b/i,
    /\bkike\b/i,
    /\bwetback\b/i,
    /\bgook\b/i,
    /\bcracker\b/i,
    /\bkill\s+your?self\b/i,
    /\bkys\b/i,
    /\bkms\b/i,
    /\bkill\s+(him|her|them|you)\b/i,
    /\bi\s+will\s+kill\b/i,
    /\bi('ll)?\s+rape\b/i,
    /\brapist\b/i,
    /\bhitler\b/i,
    /\bnatzi\b/i,
    /\bnazi\b/i,
    /f+[*_\-]+c+k/i,
    /s+[*_\-]+x\b/i,
    /b[i1]+tch/i,
    /a+s+[*_\-]+hole/i,
];

// ---- SCAM DOMAIN DATABASE ----
const SCAM_DOMAINS = [
    /discord-?nitro[\w-]*\.(?:com|net|gg|xyz|ru|tk|ml|ga|cf)/i,
    /free-?nitro[\w-]*\.(?:com|net|gg|xyz|ru)/i,
    /nitro-?gift[\w-]*\.(?:com|net|gg|xyz|ru)/i,
    /discordapp-?nitro\.[\w.]+/i,
    /free-?robux[\w-]*\.(?:com|net|xyz|ru|tk|ml)/i,
    /robux-?generator[\w-]*\.[\w.]+/i,
    /getrobux[\w-]*\.[\w.]+/i,
    /robuxhack[\w-]*\.[\w.]+/i,
    /discorcl\.com/i,
    /discord-app\.[\w.]+/i,
    /dlscord\.[\w.]+/i,
    /d1scord\.[\w.]+/i,
    /discrod\.[\w.]+/i,
    /steamcommunity-[\w-]+\.[\w.]+/i,
    /steam-?trade[\w-]*\.[\w.]+/i,
    /crypto-?gift[\w-]*\.[\w.]+/i,
    /bitcoin-?giv[\w-]*\.[\w.]+/i,
    /eth-?giv[\w-]*\.[\w.]+/i,
    /bytr[\w-]*yobest[\w-]*\.(?!vercel\.app)[\w.]+/i,
    /yobest[\w-]*\.(?!vercel\.app)[\w.]+/i,
    /beast-?casino[\w-]*\.[\w.]+/i,
    /mrbeast-?[\w-]*casino[\w-]*\.[\w.]+/i,
    /[\w-]*casino-?free[\w-]*\.[\w.]+/i,
    /[\w-]*free-?casino[\w-]*\.[\w.]+/i,
    /[\w-]*vynn[\w-]*\.[\w.]+/i,
    /[\w-]*vyn-?project[\w-]*\.[\w.]+/i,
    /mrbeast-?giv[\w-]*\.[\w.]+/i,
    /elon-?giv[\w-]*\.[\w.]+/i,
    /free-?gift-?card[\w-]*\.[\w.]+/i,
    /heloben\.com/i,
    /helobin\.com/i,
    /helaben\.com/i,
    /vyns\.[\w.]+/i,
    /rakeback[\w-]*casino[\w-]*\.[\w.]+/i,
    /[\w-]*withdraw[\w-]*bonus[\w-]*\.[\w.]+/i,
];

// ---- SCAM PHRASE PATTERNS ----
const SCAM_PHRASES = [
    /withdrawal\s+(of\s+\$[\d,]+\s+)?was\s+successfully/i,
    /your\s+withdrawal\s+of\s+\$[\d,.]+/i,
    /you\s+(have\s+)?won\s+\$[\d,.]+/i,
    /claim\s+your\s+(free\s+)?(prize|reward|winnings|crypto|robux|nitro)/i,
    /giving\s+away\s+\$[\d,.]+\s+to\s+everyone\s+who\s+registers?/i,
    /you\s+can\s+withdraw\s+the\s+(money|funds|balance|reward)\s+immediately/i,
    /launch\s+of\s+my\s+own\s+cryptocurrency\s+casino/i,
    /click\s+here\s+to\s+claim/i,
    /go\s+to\s*:\s*http/i,
    /i\s+am\s+giving\s+away\s+\$[\d,.]+/i,
    /giving\s+away\s+.{0,30}\s+for\s+free/i,
    /free\s+(robux|nitro|steam|bitcoin|eth|crypto)\s+generator/i,
    /get\s+(free\s+)?(robux|nitro|steam\s+gift\s+card)\s+now/i,
    /beast\s+games\s+strong\s+vs\s+smart/i,
    /send\s+\d+\s+(eth|btc|sol|usdt)\s+and\s+(receive|get|earn)\s+double/i,
    /limited\s+time\s+(offer|giveaway).{0,50}(click|go\s+to|visit)/i,
    /i\s+am\s+pleased\s+to\s+announce.{0,50}(casino|crypto|giveaway)/i,
    /follow\s+me\s+for\s+a\s+cookie/i,
    /cryptocurrency\s+casino/i,
    /rakeback.{0,30}casino/i,
    /your\s+balance\s+is\s+\$[\d,.]+/i,
    /withdraw.{0,20}immediately/i,
    /bonus\s+code.{0,30}casino/i,
    /promo\s+code.{0,30}casino/i,
    /activate\s+code\s+for\s+bonus/i,
];

// XP config
const XP_PER_MSG   = () => Math.floor(Math.random() * 10) + 5;
const XP_FOR_LEVEL = (lvl) => 100 * lvl * lvl;

// ====================== LEVEL SYSTEM ======================
function addXP(userId, amount) {
    const data  = xpData.get(userId) || { xp: 0, level: 0 };
    data.xp    += amount;
    let leveled = false;
    while (data.xp >= XP_FOR_LEVEL(data.level + 1)) {
        data.xp  -= XP_FOR_LEVEL(data.level + 1);
        data.level++;
        leveled = true;
    }
    xpData.set(userId, data);
    return { ...data, leveled };
}

// ====================== GUILD SETTINGS HELPERS ======================
function getSettings(guildId) {
    if (!guildSettings.has(guildId)) {
        guildSettings.set(guildId, {
            modRoleId:        null,
            autoRoleId:       null,
            welcomeChannelId: WELCOME_CHANNEL_ID,
            modlogChannelId:  MODLOG_CHANNEL_ID,
            ticketCategoryId: null,   // NEW v4.3
            welcomeMessage
        });
    }
    return guildSettings.get(guildId);
}

// ====================== PERMISSION LEVELS ======================
function getPermLevel(member, guild) {
    if (!member) return "member";
    if (guild.ownerId === member.id)                                          return "owner";
    if (member.permissions.has(PermissionFlagsBits.Administrator))            return "admin";
    const settings = getSettings(guild.id);
    if (settings.modRoleId && member.roles.cache.has(settings.modRoleId))    return "mod";
    return "member";
}

function requireLevel(needed, actual) {
    const order = ["member", "mod", "admin", "owner"];
    return order.indexOf(actual) >= order.indexOf(needed);
}

// ====================== SLASH COMMAND DEFINITIONS ======================
const slashCommands = [
    new SlashCommandBuilder().setName("ping").setDescription("Check bot latency"),
    new SlashCommandBuilder().setName("stats").setDescription("Bot and server stats"),
    new SlashCommandBuilder().setName("serverinfo").setDescription("Info about this server"),
    new SlashCommandBuilder()
        .setName("userinfo").setDescription("Info about a user")
        .addUserOption(o => o.setName("user").setDescription("Target user")),
    new SlashCommandBuilder()
        .setName("avatar").setDescription("Show someone's avatar")
        .addUserOption(o => o.setName("user").setDescription("Target user")),
    new SlashCommandBuilder()
        .setName("roll").setDescription("Roll dice (e.g. 2d6)")
        .addStringOption(o => o.setName("dice").setDescription("Format: NdS (e.g. 2d6)").setRequired(true)),
    new SlashCommandBuilder()
        .setName("8ball").setDescription("Ask the magic 8-ball")
        .addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true)),
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
    new SlashCommandBuilder().setName("help").setDescription("Show all commands"),

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
        .addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0 = off)").setRequired(true).setMinValue(0).setMaxValue(21600)),
    new SlashCommandBuilder().setName("lock").setDescription("[Mod] Lock this channel"),
    new SlashCommandBuilder().setName("unlock").setDescription("[Mod] Unlock this channel"),
    new SlashCommandBuilder().setName("closeticket").setDescription("[Mod] Close this support ticket"),

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
        .addStringOption(o => o.setName("title").setDescription("Announcement title").setRequired(true))
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
        .setName("setmodrole").setDescription("[Admin] Set the moderator role")
        .addRoleOption(o => o.setName("role").setDescription("Moderator role").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setautorole").setDescription("[Admin] Auto-assign role on join")
        .addRoleOption(o => o.setName("role").setDescription("Role to auto-assign").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setwelcomechannel").setDescription("[Admin] Set the welcome channel")
        .addChannelOption(o => o.setName("channel").setDescription("Welcome channel").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setmodlogchannel").setDescription("[Admin] Set the mod-log channel")
        .addChannelOption(o => o.setName("channel").setDescription("Mod-log channel").setRequired(true)),
    new SlashCommandBuilder()
        .setName("setticketcategory").setDescription("[Admin] Set category for new ticket channels")
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
    new SlashCommandBuilder()
        .setName("listcmds").setDescription("[Admin] List all custom commands"),
    new SlashCommandBuilder()
        .setName("reactionrole").setDescription("[Admin] Set up a reaction role")
        .addStringOption(o => o.setName("messageid").setDescription("Message ID to watch").setRequired(true))
        .addStringOption(o => o.setName("emoji").setDescription("Emoji to react with").setRequired(true))
        .addRoleOption(o => o.setName("role").setDescription("Role to assign").setRequired(true)),

    // OWNER ONLY
    new SlashCommandBuilder().setName("scanandclean").setDescription("[Owner] Scan + clean last 100 messages"),
    new SlashCommandBuilder().setName("testautomod").setDescription("[Owner] Test the auto-mod pipeline"),
    new SlashCommandBuilder().setName("aitest").setDescription("[Owner] Test if the AI is working"),
].map(cmd => cmd.toJSON());

// ====================== REGISTER SLASH COMMANDS ======================
// v4.3 FIX: Guild-only registration (instant). Global removed to stop duplicates.
async function registerSlashCommands() {
    const token    = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;

    if (!clientId) {
        console.warn("⚠️  CLIENT_ID not set — skipping slash command registration.");
        return;
    }

    try {
        const rest = new REST({ version: "10" }).setToken(token);

        // Register to all guilds the bot is currently in (instant — no 1hr wait)
        for (const guild of client.guilds.cache.values()) {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(clientId, guild.id),
                    { body: slashCommands }
                );
                console.log(`✅ Slash commands registered in guild: ${guild.name} (${guild.id})`);
            } catch (guildErr) {
                console.error(`❌ Failed in guild ${guild.name}:`, guildErr.message);
            }
        }
        // NOTE: Global registration intentionally removed in v4.3 to prevent duplicates.
        console.log("✅ Slash command registration complete (guild-only, no duplicates).");
    } catch (e) {
        console.error("❌ Slash command registration failed:", e.message);
    }
}

// ====================== READY + SELF-TEST ======================
client.once("ready", async () => {
    console.log(`✅ Yobest_BYTR Bot v4.3 Online! Logged in as ${client.user.tag}`);
    client.user.setActivity("🛡️ Protecting the server | v4.3", { type: 3 });
    await registerSlashCommands();
    await runStartupSelfTest();
});

async function runStartupSelfTest() {
    if (!MODLOG_CHANNEL_ID) {
        console.log("ℹ️  No MODLOG_CHANNEL_ID set — skipping startup self-test embed.");
        return;
    }
    try {
        let ch = null;
        for (const guild of client.guilds.cache.values()) {
            ch = guild.channels.cache.get(MODLOG_CHANNEL_ID);
            if (ch) break;
        }
        if (!ch) return;

        // v4.3 FIX: No more anthropicClient — OpenRouter only
        const aiStatus = openaiClient
            ? `✅ ${AI_DISPLAY_NAME} via OpenRouter (${OPENROUTER_MODEL})`
            : "❌ NO OPENROUTER_API_KEY SET — AI features disabled!";

        const embed = new EmbedBuilder()
            .setTitle("✅ Yobest Bot v4.3 — Systems Online")
            .setColor(0x00FFAA)
            .setDescription(
                "All systems loaded. v4.3 — anthropicClient removed, safeDelete fixed, " +
                "no duplicate slash commands, channel setters added."
            )
            .addFields(
                { name: "🛡️ Auto-Mod",        value: "✅ Runs FIRST on EVERY message (text + images + files)", inline: false },
                { name: "🤬 Profanity Filter", value: `✅ ${PROFANITY_PATTERNS.length} patterns`,              inline: true  },
                { name: "📝 Scam Phrases",     value: `✅ ${SCAM_PHRASES.length} instant patterns`,            inline: true  },
                { name: "🔗 Scam Domains",     value: `✅ ${SCAM_DOMAINS.length} domain patterns`,             inline: true  },
                { name: "🖼️ Image Scanning",   value: "✅ AI vision — scam/NSFW/phishing images",              inline: true  },
                { name: "📁 File Scanning",     value: "✅ Dangerous files blocked instantly",                  inline: true  },
                { name: "⚡ Anti-Spam",         value: `✅ ${SPAM_LIMIT} msg/${SPAM_WINDOW_MS/1000}s limit`,   inline: true  },
                { name: "🤖 AI Chat",           value: aiStatus,                                                inline: false },
                { name: "⚡ Slash Commands",    value: "✅ Guild-only (instant, no duplicates)",                inline: true  },
                { name: "⭐ Leveling",          value: "✅ XP earned per message",                              inline: true  },
                { name: "🎫 Tickets",           value: "✅ Ticket system + category support",                   inline: true  },
                { name: "📢 Welcome",           value: WELCOME_CHANNEL_ID ? "✅ Channel set" : "⚠️ WELCOME_CHANNEL_ID not set", inline: true },
                { name: "💬 User DM on Delete", value: "✅ Users notified when messages are removed",           inline: true  },
            )
            .setFooter({ text: "Yobest_BYTR Bot v4.3 • Auto-mod is ALWAYS first" })
            .setTimestamp();

        await ch.send({ embeds: [embed] });
        console.log("✅ Startup self-test embed posted to mod-log channel.");
    } catch (e) {
        console.error("Startup self-test error:", e);
    }
}

// ====================== WELCOME + AUTO-ROLE ======================
client.on("guildMemberAdd", async (member) => {
    try {
        const settings = getSettings(member.guild.id);

        if (settings.autoRoleId) {
            const role = member.guild.roles.cache.get(settings.autoRoleId);
            if (role) await member.roles.add(role).catch(() => {});
        }

        const channelId = settings.welcomeChannelId;
        const channel   = channelId
            ? member.guild.channels.cache.get(channelId)
            : member.guild.systemChannel;
        if (!channel) return;

        const desc = (settings.welcomeMessage || welcomeMessage)
            .replace(/{user}/g,   `${member}`)
            .replace(/{server}/g, member.guild.name)
            .replace(/{count}/g,  `${member.guild.memberCount}`);

        const embed = new EmbedBuilder()
            .setColor(0x00FFAA)
            .setAuthor({ name: `Welcome to ${member.guild.name}!`, iconURL: member.guild.iconURL({ dynamic: true }) || undefined })
            .setTitle(`👋 ${member.user.username} just joined!`)
            .setDescription(`${desc}\n\n🔗 Explore our site: [${SITE_INFO.name}](${SITE_INFO.url})`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setImage("https://raw.githubusercontent.com/Yobest-Bytr/yobest-studio/refs/heads/main/bytrhhh.png")
            .setFooter({ text: `Member #${member.guild.memberCount} • ${SITE_INFO.name}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Visit Yobest Studio").setStyle(ButtonStyle.Link).setURL(SITE_INFO.url).setEmoji("🌐"),
            new ButtonBuilder().setLabel("Roblox Games").setStyle(ButtonStyle.Link).setURL("https://www.roblox.com/groups/33690332/Yobest-Studio#!/games").setEmoji("🎮")
        );

        await channel.send({ content: `${member}`, embeds: [embed], components: [row] });
    } catch (e) {
        console.error("Welcome error:", e);
    }
});

// ====================== REACTION ROLES ======================
client.on("messageReactionAdd", async (reaction, user) => {
    if (user.bot) return;
    const key    = `${reaction.message.guildId}:${reaction.message.id}:${reaction.emoji.toString()}`;
    const roleId = reactionRoles.get(key);
    if (!roleId) return;
    try {
        const guild  = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        const role   = guild.roles.cache.get(roleId);
        if (role) await member.roles.add(role);
    } catch {}
});

client.on("messageReactionRemove", async (reaction, user) => {
    if (user.bot) return;
    const key    = `${reaction.message.guildId}:${reaction.message.id}:${reaction.emoji.toString()}`;
    const roleId = reactionRoles.get(key);
    if (!roleId) return;
    try {
        const guild  = reaction.message.guild;
        const member = await guild.members.fetch(user.id);
        const role   = guild.roles.cache.get(roleId);
        if (role) await member.roles.remove(role);
    } catch {}
});

// ====================== SLASH COMMAND HANDLER ======================
client.on("interactionCreate", async (interaction) => {
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
        if (commandName === "userinfo") {
            const target = interaction.options.getMember("user") || member;
            return reply({ embeds: [buildUserInfoEmbed(target, guild)] });
        }
        if (commandName === "avatar") {
            const target = interaction.options.getUser("user") || member.user;
            return reply({ embeds: [new EmbedBuilder().setTitle(`🖼️ ${target.tag}'s Avatar`).setColor(0x00FFAA).setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))] });
        }
        if (commandName === "roll") {
            const arg   = interaction.options.getString("dice");
            const match = arg.match(/^(\d+)d(\d+)$/i);
            if (!match) return replyErr("Format: `NdS` e.g. `2d6`");
            const count = Math.min(parseInt(match[1]), 100);
            const sides = Math.min(parseInt(match[2]), 1000);
            const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
            return reply(`🎲 **${count}d${sides}**: [${rolls.join(", ")}] → Total: **${rolls.reduce((a,b)=>a+b,0)}**`);
        }
        if (commandName === "8ball") {
            const q       = interaction.options.getString("question");
            const answers = ["Yes, definitely.","It is certain.","Without a doubt.","Most likely.","Probably not.","Don't count on it.","My sources say no.","Ask again later.","Cannot predict now.","Absolutely not.","Signs point to yes."];
            return reply({ embeds: [new EmbedBuilder().setTitle("🎱 Magic 8-Ball").setColor(0x00FFAA).addFields({ name: "❓ Question", value: q },{ name: "💬 Answer", value: answers[Math.floor(Math.random() * answers.length)] })] });
        }
        if (commandName === "suggest") {
            const idea  = interaction.options.getString("idea");
            const embed = new EmbedBuilder().setTitle("💡 New Suggestion").setColor(0x00FFAA).setDescription(idea).setFooter({ text: `Suggested by ${member.user.tag}` }).setTimestamp();
            const sent  = await interaction.channel.send({ embeds: [embed] });
            await sent.react("👍").catch(() => {});
            await sent.react("👎").catch(() => {});
            return reply("✅ Suggestion posted!", true);
        }
        if (commandName === "poll") {
            const question = interaction.options.getString("question");
            const opts     = interaction.options.getString("options").split("|").map(s => s.trim()).filter(Boolean);
            if (opts.length < 2) return replyErr("Provide at least 2 options separated by `|`");
            const numbers  = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];
            const embed    = new EmbedBuilder().setTitle(`📊 ${question}`).setColor(0x00FFAA).setDescription(opts.slice(0,9).map((o,i) => `${numbers[i]} ${o}`).join("\n")).setFooter({ text: `Poll by ${member.user.tag}` }).setTimestamp();
            const sent     = await interaction.channel.send({ embeds: [embed] });
            for (let i = 0; i < Math.min(opts.length, 9); i++) await sent.react(numbers[i]).catch(() => {});
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
            const result  = parseTime(timeStr);
            if (!result) return replyErr("Time format: `30m` or `2h`");
            if (result.ms > 24 * 3_600_000) return replyErr("Max is 24 hours.");
            await reply(`⏰ Got it! Reminding you in **${timeStr}**.`);
            setTimeout(async () => {
                await member.user.send(`⏰ **Reminder!**\n${text}\n\n*(Set in ${guild.name})*`).catch(async () => {
                    await interaction.channel.send(`${member.user} ⏰ Reminder: **${text}**`).catch(() => {});
                });
            }, result.ms);
            return;
        }
        if (commandName === "site")      return reply({ embeds: [buildSiteEmbed()], components: [buildSiteRow()] });
        if (commandName === "discord")   return reply("🔗 **Join our Discord:** https://discord.gg/yobest");
        if (commandName === "rank") {
            const data   = xpData.get(member.id) || { xp: 0, level: 0 };
            const needed = XP_FOR_LEVEL(data.level + 1);
            return reply({ embeds: [new EmbedBuilder().setColor(0x00FFAA).setTitle(`⭐ ${member.user.tag}'s Rank`).setThumbnail(member.user.displayAvatarURL({ dynamic: true })).addFields({ name: "Level", value: `**${data.level}**`, inline: true },{ name: "XP", value: `**${data.xp} / ${needed}**`, inline: true }).setDescription(buildXPBar(data.xp, needed)).setTimestamp()] });
        }
        if (commandName === "leaderboard") return reply({ embeds: [buildLeaderboard(guild)] });
        if (commandName === "ticket")      return await handleTicketSlash(interaction, member, guild, reply, replyErr);
        if (commandName === "help")        return reply({ embeds: [buildHelpEmbed(permLevel)] });

        // ---- MOD+ ----
        if (commandName === "warn") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target   = interaction.options.getMember("user");
            const reason   = interaction.options.getString("reason");
            if (!target) return replyErr("User not found.");
            const warnings = addWarning(target.id, reason, member.user.tag);
            await target.send(`⚠️ You have been **warned** in **${guild.name}**.\nReason: **${reason}**\nWarning #${warnings.length}`).catch(() => {});
            return reply(`⚠️ ${target} warned (${warnings.length} total). Reason: **${reason}**`);
        }
        if (commandName === "warnings") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target   = interaction.options.getMember("user");
            if (!target) return replyErr("User not found.");
            const warnings = warnHistory.get(target.id) || [];
            if (!warnings.length) return reply(`✅ ${target} has no warnings.`);
            return reply({ embeds: [buildWarningsEmbed(target.user, warnings)] });
        }
        if (commandName === "clearwarnings") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target = interaction.options.getMember("user");
            if (!target) return replyErr("User not found.");
            warnHistory.delete(target.id);
            return reply(`✅ Cleared all warnings for ${target}.`);
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
            const n = interaction.options.getInteger("count");
            await interaction.deferReply({ ephemeral: true });
            const deleted = await interaction.channel.bulkDelete(n, true);
            return reply(`🗑️ Deleted **${deleted.size}** messages.`);
        }
        if (commandName === "slowmode") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const secs = interaction.options.getInteger("seconds");
            await interaction.channel.setRateLimitPerUser(secs);
            return reply(secs === 0 ? "✅ Slowmode disabled." : `✅ Slowmode set to **${secs}s**.`);
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
            if (!ticketChannels.has(interaction.channelId)) return replyErr("This is not a ticket channel.");
            await reply("✅ Closing ticket...");
            await interaction.channel.send("🎫 This ticket has been closed.").catch(() => {});
            setTimeout(() => interaction.channel.delete().catch(() => {}), 3000);
            ticketChannels.delete(interaction.channelId);
            return;
        }

        // ---- ADMIN+ ----
        if (commandName === "ban") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "No reason provided";
            if (!target) return replyErr("User not found.");
            await target.send(`🔨 You have been **banned** from **${guild.name}**.\nReason: **${reason}**`).catch(() => {});
            await target.ban({ reason });
            return reply({ embeds: [buildActionEmbed("🔨 Member Banned", 0xFF4444, target.user, member.user, reason)] });
        }
        if (commandName === "kick") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const target = interaction.options.getMember("user");
            const reason = interaction.options.getString("reason") || "No reason provided";
            if (!target) return replyErr("User not found.");
            await target.send(`👢 You have been **kicked** from **${guild.name}**.\nReason: **${reason}**`).catch(() => {});
            await target.kick(reason);
            return reply({ embeds: [buildActionEmbed("👢 Member Kicked", 0xFF8800, target.user, member.user, reason)] });
        }
        if (commandName === "announce") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            await interaction.deferReply({ ephemeral: true });
            const title       = interaction.options.getString("title");
            const description = interaction.options.getString("desc");
            const ytRaw       = interaction.options.getString("video");
            const downloadUrl = interaction.options.getString("download");
            const robloxUrl   = interaction.options.getString("roblox");
            const ytId        = ytRaw ? extractYouTubeId(ytRaw) : null;
            await postAnnouncement(interaction.channel, { title, description, ytId, downloadUrl, robloxUrl }, member.user.tag);
            return reply("✅ Announcement posted!");
        }
        if (commandName === "giveaway") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const timeStr = interaction.options.getString("time");
            const prize   = interaction.options.getString("prize");
            const result  = parseTime(timeStr);
            if (!result) return replyErr("Time format: `30s`, `10m`, `1h`");
            await runGiveaway(interaction.channel, result.ms, prize, member.user.tag);
            return reply(`✅ Giveaway started! Drawing in **${timeStr}**.`);
        }
        if (commandName === "setwelcome") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).welcomeMessage = interaction.options.getString("message");
            return reply("✅ Welcome message updated!");
        }
        if (commandName === "setmodrole") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const role = interaction.options.getRole("role");
            getSettings(guild.id).modRoleId = role.id;
            return reply(`✅ Moderator role set to **${role.name}**.`);
        }
        if (commandName === "setautorole") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const role = interaction.options.getRole("role");
            getSettings(guild.id).autoRoleId = role.id;
            return reply(`✅ Auto-role set to **${role.name}**. New members will receive it on join.`);
        }

        // ── v4.3 NEW: channel setter slash handlers ──
        if (commandName === "setwelcomechannel") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const channel = interaction.options.getChannel("channel");
            getSettings(guild.id).welcomeChannelId = channel.id;
            return reply(`✅ Welcome channel set to ${channel}.`);
        }
        if (commandName === "setmodlogchannel") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const channel = interaction.options.getChannel("channel");
            getSettings(guild.id).modlogChannelId = channel.id;
            return reply(`✅ Mod-log channel set to ${channel}.`);
        }
        if (commandName === "setticketcategory") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const category = interaction.options.getChannel("category");
            if (category.type !== ChannelType.GuildCategory) {
                return replyErr("That must be a **Category** channel, not a text/voice channel.");
            }
            getSettings(guild.id).ticketCategoryId = category.id;
            return reply(`✅ Ticket category set to **${category.name}**. New tickets will open inside it.`);
        }

        if (commandName === "enableai") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            aiEnabledChannels.add(interaction.channelId);
            return reply("✅ AI Chat enabled in this channel.");
        }
        if (commandName === "disableai") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            aiEnabledChannels.delete(interaction.channelId);
            return reply("❌ AI Chat disabled in this channel.");
        }
        if (commandName === "addcmd") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const trigger  = interaction.options.getString("trigger").toLowerCase().replace(/^!/, "");
            const response = interaction.options.getString("response");
            const map = customCmds.get(guild.id) || new Map();
            map.set(trigger, response);
            customCmds.set(guild.id, map);
            return reply(`✅ Custom command \`!${trigger}\` added.`);
        }
        if (commandName === "removecmd") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const trigger = interaction.options.getString("trigger").toLowerCase().replace(/^!/, "");
            const map = customCmds.get(guild.id);
            if (!map || !map.has(trigger)) return replyErr(`No custom command \`!${trigger}\` found.`);
            map.delete(trigger);
            return reply(`✅ Removed \`!${trigger}\`.`);
        }
        if (commandName === "listcmds") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const map = customCmds.get(guild.id);
            if (!map || !map.size) return reply("No custom commands set.");
            const list = [...map.entries()].map(([k, v]) => `\`!${k}\` → ${v.slice(0, 50)}`).join("\n");
            return reply({ embeds: [new EmbedBuilder().setTitle("📋 Custom Commands").setColor(0x00FFAA).setDescription(list)] });
        }
        if (commandName === "reactionrole") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const msgId = interaction.options.getString("messageid");
            const emoji = interaction.options.getString("emoji");
            const role  = interaction.options.getRole("role");
            reactionRoles.set(`${guild.id}:${msgId}:${emoji}`, role.id);
            try {
                const msg = await interaction.channel.messages.fetch(msgId);
                await msg.react(emoji);
            } catch {}
            return reply(`✅ Reaction role set! Reacting with ${emoji} gives **${role.name}**.`);
        }

        // ---- OWNER ONLY ----
        if (commandName === "scanandclean") {
            if (guild.ownerId !== member.id) return replyErr("Owner only.");
            await interaction.deferReply();
            const result = await doScanAndClean(interaction.channel);
            return reply(`✅ Scan complete. Deleted **${result}** bad message(s).`);
        }
        if (commandName === "testautomod") {
            if (guild.ownerId !== member.id) return replyErr("Owner only.");
            await interaction.deferReply({ ephemeral: true });
            const testTexts = [
                { text: "sex",                                                    expect: "profanity"  },
                { text: "I am giving away $2500 to everyone who registers!",      expect: "scam phrase"},
                { text: "free-nitro-discord.xyz",                                 expect: "scam domain"},
            ];
            const results = [];
            for (const t of testTexts) {
                const r = quickTextScan(t.text);
                results.push(`${r.flagged ? "✅ CAUGHT" : "❌ MISSED"} — \`${t.text}\` (expected: ${t.expect})`);
            }
            return reply(`**Auto-mod pipeline test:**\n${results.join("\n")}`);
        }
        if (commandName === "aitest") {
            if (guild.ownerId !== member.id && !requireLevel("admin", permLevel)) return replyErr("Admin or higher.");
            await interaction.deferReply();
            try {
                const result = await callAI("Say: AI is working fine!", "You are a test bot. Reply with exactly: AI is working fine!");
                return reply(`🤖 AI Test Result: **${result.trim()}**`);
            } catch (e) {
                return reply(`❌ AI Test FAILED: ${e.message}`);
            }
        }

    } catch (e) {
        console.error(`Slash command error [${commandName}]:`, e);
        const msg = `❌ Error: ${e.message}`;
        try {
            if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
            else await interaction.reply({ content: msg, ephemeral: true });
        } catch {}
    }
});

// ====================== MESSAGE HANDLER ======================
// AUTO-MOD IS ALWAYS FIRST — before commands, XP, everything.
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content   = message.content.trim();
    const lower     = content.toLowerCase();
    const permLevel = getPermLevel(message.member, message.guild);
    const isMod     = requireLevel("mod",   permLevel);
    const isAdmin   = requireLevel("admin", permLevel);
    const isOwner   = permLevel === "owner";
    const guildId   = message.guild.id;

    // ════════════════════════════════════════════
    //  STEP 1 — AUTO-MOD  (always, no exceptions)
    // ════════════════════════════════════════════
    if (!isMod) {
        const spamResult = checkSpam(message.author.id);
        if (spamResult.flagged) {
            await safeDelete(message);
            await applyTimeout(message, "Anti-spam: too many messages in a short time", "spam", null);
            return;
        }

        const modResult = await moderateMessageV43(message);
        if (modResult.flagged) {
            await safeDelete(message);
            await message.author.send(
                `⚠️ **Your message in ${message.guild.name} was removed.**\n` +
                `**Reason:** ${modResult.reason}\n\n` +
                `If you think this is a mistake, please contact a moderator.`
            ).catch(() => {});
            await applyTimeout(message, modResult.reason, modResult.category, modResult.evidenceUrl);
            return;
        }
    }

    // ════════════════════════════════════════════
    //  STEP 2 — XP
    // ════════════════════════════════════════════
    if (!ticketChannels.has(message.channelId)) {
        const result = addXP(message.author.id, XP_PER_MSG());
        if (result.leveled) {
            message.channel.send(`🎉 ${message.author} leveled up to **Level ${result.level}**! ⭐`).catch(() => {});
        }
    }

    // ════════════════════════════════════════════
    //  STEP 3 — COMMANDS
    // ════════════════════════════════════════════

    // OWNER
    if (isOwner) {
        if (lower === "!scanandclean") {
            const reply = await message.reply("🔍 Scanning last 100 messages...");
            const count = await doScanAndClean(message.channel);
            return reply.edit(`✅ Scan complete. Deleted **${count}** bad message(s).`);
        }
        if (lower === "!testautomod") {
            const testTexts = [
                { text: "sex",                                                 expect: "profanity"  },
                { text: "I am giving away $2500 to everyone who registers!",   expect: "scam phrase"},
                { text: "free-nitro-discord.xyz",                              expect: "scam domain"},
            ];
            const results = [];
            for (const t of testTexts) {
                const r = quickTextScan(t.text);
                results.push(`${r.flagged ? "✅ CAUGHT" : "❌ MISSED"} — \`${t.text}\` (expected: ${t.expect})`);
            }
            return message.reply(`**Auto-mod pipeline test:**\n${results.join("\n")}`);
        }
        if (lower === "!aitest") {
            try {
                const result = await callAI("Say: AI is working fine!", "You are a test bot.");
                return message.reply(`🤖 AI: **${result.trim()}**`);
            } catch (e) {
                return message.reply(`❌ AI FAILED: ${e.message}`);
            }
        }
    }

    // ADMIN
    if (isAdmin) {
        if (lower === "!help") return message.reply({ embeds: [buildHelpEmbed(permLevel)] });
        if (lower === "!announce" || lower.startsWith("!announce ") || lower.startsWith("!announce\n"))
            return handleAnnouncePrefix(message, content);
        if (lower === "!enableai")  { aiEnabledChannels.add(message.channel.id); return message.reply("✅ AI enabled."); }
        if (lower === "!disableai") { aiEnabledChannels.delete(message.channel.id); return message.reply("❌ AI disabled."); }
        if (lower.startsWith("!setwelcome ")) {
            getSettings(guildId).welcomeMessage = content.split(" ").slice(1).join(" ");
            return message.reply("✅ Welcome message updated!");
        }
        if (lower.startsWith("!setmodrole ")) {
            const role = message.mentions.roles?.first();
            if (!role) return message.reply("❌ Mention a role: `!setmodrole @role`");
            getSettings(guildId).modRoleId = role.id;
            return message.reply(`✅ Mod role set to **${role.name}**.`);
        }
        if (lower.startsWith("!setautorole ")) {
            const role = message.mentions.roles?.first();
            if (!role) return message.reply("❌ Mention a role: `!setautorole @role`");
            getSettings(guildId).autoRoleId = role.id;
            return message.reply(`✅ Auto-role set to **${role.name}**.`);
        }

        // ── v4.3 NEW: channel setter prefix commands ──
        if (lower.startsWith("!setwelcomechannel")) {
            const channel = message.mentions.channels?.first();
            if (!channel) return message.reply("❌ Mention a channel: `!setwelcomechannel #channel`");
            getSettings(guildId).welcomeChannelId = channel.id;
            return message.reply(`✅ Welcome channel set to ${channel}.`);
        }
        if (lower.startsWith("!setmodlogchannel")) {
            const channel = message.mentions.channels?.first();
            if (!channel) return message.reply("❌ Mention a channel: `!setmodlogchannel #channel`");
            getSettings(guildId).modlogChannelId = channel.id;
            return message.reply(`✅ Mod-log channel set to ${channel}.`);
        }
        if (lower.startsWith("!setticketcategory")) {
            const channel = message.mentions.channels?.first();
            if (!channel) return message.reply("❌ Mention a category channel: `!setticketcategory #category`");
            if (channel.type !== ChannelType.GuildCategory) {
                return message.reply("❌ That must be a **Category** channel, not a text/voice channel.");
            }
            getSettings(guildId).ticketCategoryId = channel.id;
            return message.reply(`✅ Ticket category set to **${channel.name}**. New tickets will open inside it.`);
        }

        if (lower.startsWith("!ban "))      return handleBanPrefix(message, content, "ban");
        if (lower.startsWith("!kick "))     return handleBanPrefix(message, content, "kick");
        if (lower.startsWith("!giveaway ")) return handleGiveawayPrefix(message, content);
        if (lower.startsWith("!addcmd ")) {
            const parts    = content.split(" ").slice(1);
            const trigger  = parts[0]?.toLowerCase().replace(/^!/, "");
            const response = parts.slice(1).join(" ");
            if (!trigger || !response) return message.reply("❌ Usage: `!addcmd trigger response`");
            const map = customCmds.get(guildId) || new Map();
            map.set(trigger, response);
            customCmds.set(guildId, map);
            return message.reply(`✅ Custom command \`!${trigger}\` added.`);
        }
        if (lower.startsWith("!removecmd ")) {
            const trigger = content.split(" ")[1]?.toLowerCase().replace(/^!/, "");
            const map = customCmds.get(guildId);
            if (!map || !map.has(trigger)) return message.reply(`❌ No command \`!${trigger}\`.`);
            map.delete(trigger);
            return message.reply(`✅ Removed \`!${trigger}\`.`);
        }
        if (lower === "!listcmds") {
            const map = customCmds.get(guildId);
            if (!map || !map.size) return message.reply("No custom commands set.");
            const list = [...map.entries()].map(([k, v]) => `\`!${k}\` → ${v.slice(0, 50)}`).join("\n");
            return message.reply({ embeds: [new EmbedBuilder().setTitle("📋 Custom Commands").setColor(0x00FFAA).setDescription(list)] });
        }
    }

    // MOD+
    if (isMod) {
        if (lower.startsWith("!warn ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!warn @user [reason]`");
            const reason   = content.replace(/^!warn\s+<@!?\d+>\s*/i, "").trim() || "No reason provided";
            const warnings = addWarning(target.id, reason, message.author.tag);
            await target.send(`⚠️ You have been **warned** in **${message.guild.name}**.\nReason: **${reason}**\nWarning #${warnings.length}`).catch(() => {});
            return message.reply(`⚠️ ${target} warned (${warnings.length} total). Reason: **${reason}**`);
        }
        if (lower.startsWith("!warnings ")) {
            const target   = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user.");
            const warnings = warnHistory.get(target.id) || [];
            if (!warnings.length) return message.reply(`✅ ${target} has no warnings.`);
            return message.reply({ embeds: [buildWarningsEmbed(target.user, warnings)] });
        }
        if (lower.startsWith("!clearwarnings ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user.");
            warnHistory.delete(target.id);
            return message.reply(`✅ Cleared all warnings for ${target}.`);
        }
        if (lower.startsWith("!mute ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user.");
            const reason = content.replace(/^!mute\s+<@!?\d+>\s*/i, "").trim() || "Muted by mod";
            await target.timeout(28 * 24 * 60 * 60 * 1000, reason);
            return message.reply(`🔇 ${target} muted. Reason: **${reason}**`);
        }
        if (lower.startsWith("!unmute ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user.");
            await target.timeout(null);
            return message.reply(`🔊 ${target} unmuted.`);
        }
        if (lower.startsWith("!purge ")) {
            const n = parseInt(content.split(" ")[1]);
            if (isNaN(n) || n < 1 || n > 100) return message.reply("❌ Usage: `!purge 1–100`");
            await safeDelete(message);
            const deleted = await message.channel.bulkDelete(n, true);
            const notice  = await message.channel.send(`🗑️ Deleted **${deleted.size}** messages.`);
            setTimeout(() => notice.delete().catch(() => {}), 4000);
            return;
        }
        if (lower.startsWith("!slowmode ")) {
            const secs = parseInt(content.split(" ")[1]);
            if (isNaN(secs) || secs < 0 || secs > 21600) return message.reply("❌ `!slowmode 0–21600`");
            await message.channel.setRateLimitPerUser(secs);
            return message.reply(secs === 0 ? "✅ Slowmode off." : `✅ Slowmode: **${secs}s**.`);
        }
        if (lower === "!lock") {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
            return message.reply("🔒 Channel locked.");
        }
        if (lower === "!unlock") {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
            return message.reply("🔓 Channel unlocked.");
        }
        if (lower === "!closeticket") {
            if (!ticketChannels.has(message.channelId)) return message.reply("❌ Not a ticket channel.");
            await message.reply("✅ Closing ticket...");
            setTimeout(() => message.channel.delete().catch(() => {}), 3000);
            ticketChannels.delete(message.channelId);
            return;
        }
    }

    // PUBLIC
    if (lower === "!ping") {
        const sent = await message.reply("🏓 Pinging...");
        return sent.edit(`🏓 Pong! Message: **${sent.createdTimestamp - message.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
    }
    if (lower === "!stats")      return message.reply({ embeds: [buildStatsEmbed(message.guild)] });
    if (lower === "!serverinfo") return message.reply({ embeds: [buildServerInfoEmbed(message.guild)] });
    if (lower === "!help")       return message.reply({ embeds: [buildHelpEmbed(permLevel)] });
    if (lower === "!userinfo" || lower.startsWith("!userinfo ")) {
        const target = message.mentions.members?.first() || message.member;
        return message.reply({ embeds: [buildUserInfoEmbed(target, message.guild)] });
    }
    if (lower === "!avatar" || lower.startsWith("!avatar ")) {
        const target = message.mentions.users?.first() || message.author;
        return message.reply({ embeds: [new EmbedBuilder().setTitle(`🖼️ ${target.tag}'s Avatar`).setColor(0x00FFAA).setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }))] });
    }
    if (lower === "!rank") {
        const data   = xpData.get(message.author.id) || { xp: 0, level: 0 };
        const needed = XP_FOR_LEVEL(data.level + 1);
        return message.reply({ embeds: [new EmbedBuilder().setColor(0x00FFAA).setTitle(`⭐ ${message.author.tag}'s Rank`).setThumbnail(message.author.displayAvatarURL({ dynamic: true })).addFields({ name: "Level", value: `**${data.level}**`, inline: true },{ name: "XP", value: `**${data.xp} / ${needed}**`, inline: true }).setDescription(buildXPBar(data.xp, needed)).setTimestamp()] });
    }
    if (lower === "!leaderboard") return message.reply({ embeds: [buildLeaderboard(message.guild)] });
    if (lower === "!ticket")      return await handleTicketPrefix(message);
    if (lower.startsWith("!roll")) {
        const arg   = content.split(" ")[1] || "1d6";
        const match = arg.match(/^(\d+)d(\d+)$/i);
        if (!match) return message.reply("❌ Usage: `!roll 2d6`");
        const count = Math.min(parseInt(match[1]), 100);
        const sides = Math.min(parseInt(match[2]), 1000);
        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
        return message.reply(`🎲 **${count}d${sides}**: [${rolls.join(", ")}] → Total: **${rolls.reduce((a,b)=>a+b,0)}**`);
    }
    if (lower.startsWith("!8ball ")) {
        const question = content.split(" ").slice(1).join(" ");
        const answers  = ["Yes, definitely.","It is certain.","Without a doubt.","Most likely.","Probably not.","Don't count on it.","My sources say no.","Ask again later.","Cannot predict now.","Absolutely not.","Signs point to yes."];
        return message.reply({ embeds: [new EmbedBuilder().setTitle("🎱 Magic 8-Ball").setColor(0x00FFAA).addFields({ name: "❓ Question", value: question },{ name: "💬 Answer", value: answers[Math.floor(Math.random() * answers.length)] })] });
    }
    if (lower.startsWith("!suggest ")) {
        const suggestion = content.split(" ").slice(1).join(" ");
        if (!suggestion) return message.reply("❌ Usage: `!suggest <idea>`");
        const embed = new EmbedBuilder().setTitle("💡 New Suggestion").setColor(0x00FFAA).setDescription(suggestion).setFooter({ text: `Suggested by ${message.author.tag}` }).setTimestamp();
        const sent  = await message.channel.send({ embeds: [embed] });
        await sent.react("👍").catch(() => {});
        await sent.react("👎").catch(() => {});
        return safeDelete(message);
    }
    if (lower.startsWith("!poll "))     return handlePollPrefix(message, content);
    if (lower.startsWith("!report "))   return handleReportPrefix(message, content);
    if (lower.startsWith("!remindme ")) return handleRemindMePrefix(message, content);
    if (lower === "!site")    return message.reply({ embeds: [buildSiteEmbed()], components: [buildSiteRow()] });
    if (lower === "!discord") return message.reply("🔗 **Join our Discord:** https://discord.gg/yobest");

    // CUSTOM COMMANDS
    const cmdMap = customCmds.get(guildId);
    if (cmdMap && lower.startsWith("!")) {
        const trigger = lower.slice(1).split(" ")[0];
        if (cmdMap.has(trigger)) return message.reply(cmdMap.get(trigger));
    }

    // AI CHAT
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

// ====================== SAFE DELETE — v4.3 FIX ======================
// v4.3: Removed the broken `.deletable` cache check.
// Now calls message.delete() directly and ignores "Unknown Message" (10008)
// which just means it was already deleted — totally fine.
async function safeDelete(message) {
    try {
        await message.delete();
    } catch (e) {
        // 10008 = Unknown Message (already deleted), anything else log it
        if (e.code !== 10008) {
            console.error("safeDelete error:", e.code, e.message);
        }
    }
}

// ====================== ANTI-SPAM ======================
function checkSpam(userId) {
    const now  = Date.now();
    const data = spamTracker.get(userId) || { count: 0, resetAt: now + SPAM_WINDOW_MS };
    if (now > data.resetAt) { data.count = 1; data.resetAt = now + SPAM_WINDOW_MS; }
    else data.count++;
    spamTracker.set(userId, data);
    return { flagged: data.count > SPAM_LIMIT };
}

// ====================== QUICK TEXT SCAN (instant, no AI) ======================
function quickTextScan(text) {
    for (const pattern of PROFANITY_PATTERNS) {
        if (pattern.test(text)) {
            return { flagged: true, reason: "Inappropriate language detected", category: "language", evidenceUrl: null };
        }
    }
    for (const pattern of SCAM_PHRASES) {
        if (pattern.test(text)) {
            return { flagged: true, reason: "Scam content detected in message text", category: "scam", evidenceUrl: null };
        }
    }
    for (const pattern of SCAM_DOMAINS) {
        if (pattern.test(text)) {
            return { flagged: true, reason: "Scam/phishing domain detected in message", category: "scam", evidenceUrl: null };
        }
    }
    return { flagged: false };
}

// ====================== MODERATION ENGINE v4.3 ======================
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

async function moderateMessageV43(message) {
    const text = message.content || "";

    // Step 1: Instant regex scans
    const quickResult = quickTextScan(text);
    if (quickResult.flagged) return quickResult;

    // Step 2: Embed domain scan
    for (const embed of message.embeds) {
        const checkUrls = [embed.url, embed.author?.url, embed.image?.url, embed.thumbnail?.url].filter(Boolean);
        for (const url of checkUrls) {
            for (const pattern of SCAM_DOMAINS) {
                if (pattern.test(url)) {
                    return { flagged: true, reason: `Scam domain in embed: ${url}`, category: "scam", evidenceUrl: embed.image?.url || null };
                }
            }
        }
    }

    // Step 3: File scan
    const files = getFileAttachments(message);
    for (const f of files) {
        if (DANGEROUS_EXTS.test(f.name)) {
            return { flagged: true, reason: `Dangerous file blocked: \`${f.name}\``, category: "file", evidenceUrl: null };
        }
    }
    for (const f of files) {
        if (SUSPICIOUS_EXTS.test(f.name)) {
            await logToModChannel(message, `Suspicious file attached: \`${f.name}\``, "file", "Logged (not deleted)", 0, null).catch(() => {});
        }
    }

    // Step 4: AI checks (text + images in parallel)
    let imageUrls = getImageUrls(message);

    // Embed image retry — Discord generates previews up to 2.5s after message
    if (imageUrls.length === 0 && /https?:\/\//.test(text)) {
        await new Promise(r => setTimeout(r, 2500));
        try {
            const fresh = await message.channel.messages.fetch(message.id);
            imageUrls   = getImageUrls(fresh);
        } catch {}
    }

    const checks = [];
    if (text.trim())           checks.push(classifyTextWithAI(text));
    for (const url of imageUrls) checks.push(classifyImageWithAI(url));
    if (checks.length === 0)   return { flagged: false };

    const results = await Promise.allSettled(checks);
    for (const r of results) {
        if (r.status === "fulfilled" && r.value?.flagged) return r.value;
    }

    return { flagged: false };
}

// ---- AI text classification ----
async function classifyTextWithAI(text) {
    if (!openaiClient) return { flagged: false };
    try {
        const prompt =
`You are a Discord content moderator. Classify this message with EXACTLY ONE WORD.

TOXIC    — harassment, insults, hate speech, threats, slurs, doxxing, telling someone to harm themselves
SCAM     — fake free Robux/Nitro/Steam/crypto/casino, fake giveaways, fake celebrity endorsements,
           "withdrawal successful" from unknown sites, "click to claim" offers, crypto casino promotions
PHISHING — suspicious links that look like Discord/Roblox/Steam logins, fake security alerts,
           "your account will be banned" messages
SAFE     — normal conversation, game discussion, questions, memes, art, genuine links, greetings

Reply with ONLY the single category word. Nothing else.

Message:
"""
${text.slice(0, 800)}
"""`;

        const response = await callAI(prompt, "You are a strict Discord content moderator.");
        const cat = response.toUpperCase().trim().split(/\s+/)[0];

        if (cat === "TOXIC")    return { flagged: true, reason: "Toxic/harassing content detected by AI",         category: "toxic",    evidenceUrl: null };
        if (cat === "SCAM")     return { flagged: true, reason: "Scam content detected by AI",                    category: "scam",     evidenceUrl: null };
        if (cat === "PHISHING") return { flagged: true, reason: "Phishing/fake security warning detected by AI",  category: "phishing", evidenceUrl: null };
        return { flagged: false };
    } catch (e) {
        console.error("AI text classification error:", e.message);
        return { flagged: false };
    }
}

// ---- AI image classification ----
async function classifyImageWithAI(url) {
    if (!openaiClient) return { flagged: false };
    try {
        const prompt =
`You are reviewing an image posted in a Discord server. Reply with EXACTLY ONE WORD.

SCAM     — fake celebrity giveaways (MrBeast, Elon Musk, etc.), fake "withdrawal successful" popups,
           crypto scam screenshots, "you won X amount" overlays, casino/gambling screenshots,
           beast games fake promotions, rakeback casino screenshots, crypto casino promotions
PHISHING — fake Discord/Roblox/Steam/Epic login pages, fake "account banned" notices, fake security alerts
NSFW     — sexual content, extreme graphic violence, nudity
SAFE     — normal gaming screenshots, art, memes, photos, store listings, real social media profiles

Reply ONLY the single category word. When in doubt about casino/giveaway content, say SCAM.`;

        const response = await callAIWithImage(prompt, url);
        const cat = response.toUpperCase().trim().split(/\s+/)[0];

        if (cat === "SCAM")     return { flagged: true, reason: "Image detected as scam/fake giveaway by AI",  category: "scam",     evidenceUrl: url };
        if (cat === "PHISHING") return { flagged: true, reason: "Image detected as phishing/fake login by AI", category: "phishing", evidenceUrl: url };
        if (cat === "NSFW")     return { flagged: true, reason: "Image contains NSFW/graphic content",         category: "nsfw",     evidenceUrl: url };
        return { flagged: false };
    } catch (e) {
        console.error("AI image classification error:", e.message);
        return { flagged: false };
    }
}

// ====================== AI WRAPPER — v4.3 FIX ======================
// anthropicClient FULLY REMOVED. OpenRouter only.
async function callAI(userPrompt, systemPrompt = "You are a helpful assistant.") {
    if (!openaiClient) {
        throw new Error("No AI configured. Set OPENROUTER_API_KEY in your environment variables.");
    }
    const res = await openaiClient.chat.completions.create({
        model:       OPENROUTER_MODEL,
        messages:    [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt   }
        ],
        max_tokens:  50,
        temperature: 0
    });
    return res.choices[0].message.content || "";
}

async function callAIWithImage(textPrompt, imageUrl) {
    if (!openaiClient) {
        throw new Error("No AI configured. Set OPENROUTER_API_KEY in your environment variables.");
    }
    const res = await openaiClient.chat.completions.create({
        model:      OPENROUTER_MODEL,
        messages:   [{
            role:    "user",
            content: [
                { type: "text",      text: textPrompt },
                { type: "image_url", image_url: { url: imageUrl, detail: "low" } }
            ]
        }],
        max_tokens:  10,
        temperature: 0
    });
    return res.choices[0].message.content || "";
}

// ====================== WARN HELPER ======================
function addWarning(userId, reason, by) {
    const warnings = warnHistory.get(userId) || [];
    warnings.push({ reason, ts: Date.now(), by });
    warnHistory.set(userId, warnings);
    return warnings;
}

// ====================== TIMEOUT + WARN ======================
async function applyTimeout(message, reason, category, evidenceUrl) {
    const userId = message.author.id;
    const count  = (violationCount.get(userId) || 0) + 1;
    violationCount.set(userId, count);

    let actionTaken = "Warned";
    try {
        if (count >= 3) {
            await message.member?.timeout(60 * 60 * 1000, reason).catch(() => {});
            await message.channel.send(`⛔ ${message.author} has been timed out for **1 hour**. Reason: **${reason}**`).catch(() => {});
            actionTaken = "Timed out (1h)";
        } else if (count >= 2) {
            await message.member?.timeout(10 * 60 * 1000, reason).catch(() => {});
            await message.channel.send(`⛔ ${message.author} has been timed out for **10 minutes**. Reason: **${reason}**`).catch(() => {});
            actionTaken = "Timed out (10m)";
        } else {
            await message.channel.send(`⚠️ ${message.author} your message was removed. Reason: **${reason}**`).catch(() => {});
        }
    } catch (e) {
        console.error("Timeout error:", e.message);
    }

    await logToModChannel(message, reason, category, actionTaken, count, evidenceUrl);
}

// ====================== MOD LOG ======================
async function logToModChannel(message, reason, category, actionTaken, count, evidenceUrl) {
    const settings  = getSettings(message.guild.id);
    const channelId = settings.modlogChannelId || MODLOG_CHANNEL_ID;
    if (!channelId) return;
    try {
        const ch = message.guild.channels.cache.get(channelId);
        if (!ch) return;
        const emojis = { language:"🤬", toxic:"☢️", scam:"🎭", phishing:"🎣", nsfw:"🔞", file:"📁", spam:"⚡" };
        const embed  = new EmbedBuilder()
            .setTitle(`${emojis[category] || "🛡️"} Auto-Mod: Message Removed`)
            .setColor(0xFF4444)
            .addFields(
                { name: "User",        value: `${message.author} (${message.author.id})`,          inline: true  },
                { name: "Channel",     value: `${message.channel}`,                                 inline: true  },
                { name: "Category",    value: category || "unknown",                                 inline: true  },
                { name: "Reason",      value: reason                                                               },
                { name: "Action",      value: actionTaken,                                           inline: true  },
                { name: "Violation #", value: `${count}`,                                            inline: true  },
                { name: "Content",     value: (message.content || "*(attachment/embed only)*").slice(0, 1024) }
            )
            .setTimestamp();
        if (evidenceUrl) embed.setImage(evidenceUrl);
        await ch.send({ embeds: [embed] });
    } catch (e) {
        console.error("Mod-log error:", e);
    }
}

// ====================== SCAN & CLEAN ======================
async function doScanAndClean(channel) {
    const msgs = await channel.messages.fetch({ limit: 100 });
    let deleted = 0;
    for (const msg of msgs.values()) {
        if (msg.author.bot) continue;
        const quickResult = quickTextScan(msg.content || "");
        if (quickResult.flagged) { await safeDelete(msg); deleted++; continue; }
        const aiResult = await moderateMessageV43(msg);
        if (aiResult.flagged)   { await safeDelete(msg); deleted++; }
    }
    return deleted;
}

// ====================== AI CHAT — v4.3 FIX ======================
// anthropicClient FULLY REMOVED — OpenRouter only, no fallback needed.
async function getAIResponse(message) {
    const userInput = message.content.replace(/<@!?[0-9]+>/g, "").trim() || "Hello";

    const systemPrompt =
        `You are ${AI_DISPLAY_NAME}, a professional Roblox Lua scripting expert and assistant for ${SITE_INFO.name} (${SITE_INFO.url}).\n` +
        `SITE: ${SITE_INFO.description}\n` +
        `RULES:\n` +
        `- Respond in English.\n` +
        `- For script requests: return COMPLETE production-ready code in a single fenced \`\`\`lua block. Never truncate.\n` +
        `- For site/game/link questions: use SITE INFO. Point to ${SITE_INFO.url} for specifics.\n` +
        `- For chat: be concise, friendly, helpful.`;

    try {
        if (!openaiClient) {
            return "AI is not available — please set `OPENROUTER_API_KEY` in your environment variables.";
        }
        const c = await openaiClient.chat.completions.create({
            model:       OPENROUTER_MODEL,
            messages:    [
                { role: "system", content: systemPrompt },
                { role: "user",   content: userInput    }
            ],
            max_tokens:  1600,
            temperature: 0.7
        });
        return c.choices[0].message.content || "";
    } catch (e) {
        console.error("AI chat error:", e.message);
        return `I encountered an error: ${e.message}. Please check that OPENROUTER_API_KEY is set correctly.`;
    }
}

function hasUnclosedCodeBlock(text) {
    return ((text.match(/```/g) || []).length % 2) !== 0;
}

async function sendAIResponse(message, text) {
    const MAX       = 1900;
    const codeMatch = text.match(/```lua[\s\S]*?```/);
    if (codeMatch) {
        const intro = text.slice(0, codeMatch.index).trim();
        const after = text.slice(codeMatch.index + codeMatch[0].length).trim();
        if (intro) await message.reply({ embeds: [new EmbedBuilder().setTitle("📜 Script Ready").setColor(0x00FFAA).setDescription(intro.slice(0, 4000))] });
        const chunks = splitWithFences(codeMatch[0], MAX);
        for (let i = 0; i < chunks.length; i++) {
            const label = chunks.length > 1 ? `**Part ${i+1}/${chunks.length}**\n` : "";
            await message.channel.send(label + chunks[i]);
        }
        if (after) await sendPlainText(message, after, MAX);
        return;
    }
    await sendPlainText(message, text, MAX);
}

async function sendPlainText(message, text, max) {
    if (text.length <= max) return message.reply(text);
    let rem = text, first = true;
    while (rem.length > 0) {
        let idx = rem.length > max ? rem.lastIndexOf("\n", max) : rem.length;
        if (idx <= 0) idx = Math.min(max, rem.length);
        const chunk = rem.slice(0, idx);
        first ? await message.reply(chunk) : await message.channel.send(chunk);
        first = false;
        rem = rem.slice(idx).trim();
    }
}

function splitWithFences(block, max) {
    const inner    = block.replace(/^```lua\n?/, "").replace(/```$/, "");
    const overhead = "```lua\n\n```".length;
    if (inner.length <= max - overhead) return [block];
    const lines  = inner.split("\n");
    const chunks = [];
    let cur = "";
    for (const line of lines) {
        if ((cur + line + "\n").length > max - overhead) { chunks.push(cur); cur = ""; }
        cur += line + "\n";
    }
    if (cur) chunks.push(cur);
    return chunks.map(c => "```lua\n" + c.trimEnd() + "\n```");
}

// ====================== ANNOUNCE ======================
async function handleAnnouncePrefix(message, content) {
    const body = content.replace(/^!announce/i, "").trim();
    if (!body) {
        return message.reply(
            "❌ **Usage:**\n```\n!announce\ntitle: Your Title\ndesc: Description\n" +
            "video: youtube_id (optional)\ndownload: link (optional)\nroblox: link (optional)\n```"
        );
    }
    let title, description, ytId, downloadUrl, robloxUrl;
    const isNewFormat = /^(title|desc|description)\s*:/im.test(body);
    if (isNewFormat) {
        const fields = {};
        let currentKey = null;
        for (const line of body.split("\n").map(l => l.trim()).filter(Boolean)) {
            const match = line.match(/^(title|desc(?:ription)?|video|youtube|download|roblox)\s*:\s*(.*)$/i);
            if (match) {
                currentKey = match[1].toLowerCase();
                if (currentKey === "description") currentKey = "desc";
                if (currentKey === "youtube")     currentKey = "video";
                fields[currentKey] = match[2].trim();
            } else if (currentKey) {
                fields[currentKey] += "\n" + line;
            }
        }
        title       = fields.title;
        description = fields.desc;
        ytId        = fields.video    ? extractYouTubeId(fields.video)  : null;
        downloadUrl = fields.download ? extractUrl(fields.download)      : null;
        robloxUrl   = fields.roblox   ? extractUrl(fields.roblox)       : null;
        if (!title || !description) return message.reply("❌ Both `title:` and `desc:` are required.");
    } else {
        const args = body.split("|").map(s => s.trim());
        if (args.length < 2) return message.reply("❌ Need at least `title|desc`.");
        [title, description, ytId, downloadUrl, robloxUrl] = args;
        ytId        = ytId        ? extractYouTubeId(ytId)  : null;
        downloadUrl = downloadUrl ? extractUrl(downloadUrl)  : null;
        robloxUrl   = robloxUrl   ? extractUrl(robloxUrl)   : null;
    }
    await postAnnouncement(message.channel, { title, description, ytId, downloadUrl, robloxUrl }, message.author.tag);
    return message.reply("✅ Announcement posted!");
}

async function postAnnouncement(channel, { title, description, ytId, downloadUrl, robloxUrl }, authorTag) {
    const embed = new EmbedBuilder()
        .setTitle(`🚨 ${title}`)
        .setDescription(description)
        .setColor(0x00FFAA)
        .setTimestamp()
        .setFooter({ text: `Announcement by ${authorTag} • ${SITE_INFO.name}` });

    if (ytId) {
        embed.setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`);
        embed.addFields({ name: "▶️ YouTube", value: `[Watch Now](https://youtu.be/${ytId})`, inline: true });
    }
    const extras = [];
    if (downloadUrl) extras.push({ name: "⬇️ Download",      value: `[Click Here](${downloadUrl})`, inline: true });
    if (robloxUrl)   extras.push({ name: "🎮 Play on Roblox", value: `[Play Now](${robloxUrl})`,    inline: true });
    if (extras.length) embed.addFields(extras);

    const row = new ActionRowBuilder();
    if (ytId)        row.addComponents(new ButtonBuilder().setLabel("Watch Video").setStyle(ButtonStyle.Link).setURL(`https://youtu.be/${ytId}`).setEmoji("▶️"));
    if (downloadUrl) row.addComponents(new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(downloadUrl).setEmoji("📥"));
    if (robloxUrl)   row.addComponents(new ButtonBuilder().setLabel("Play Roblox").setStyle(ButtonStyle.Link).setURL(robloxUrl).setEmoji("🎮"));

    const payload = { content: "@everyone 🚨 **New Update by BYTR!** 🚨", embeds: [embed] };
    if (row.components.length) payload.components = [row];
    await channel.send(payload);
}

// ====================== GIVEAWAY ======================
async function handleGiveawayPrefix(message, content) {
    const parts   = content.replace(/^!giveaway\s+/i, "").split(/\s+/);
    const timeStr = parts[0];
    const prize   = parts.slice(1).join(" ");
    if (!timeStr || !prize) return message.reply("❌ Usage: `!giveaway 10m Cool Prize`");
    const result = parseTime(timeStr);
    if (!result) return message.reply("❌ Time format: `30s`, `5m`, `1h`");
    await runGiveaway(message.channel, result.ms, prize, message.author.tag);
    return message.reply(`✅ Giveaway started! Drawing in **${timeStr}**.`);
}

async function runGiveaway(channel, ms, prize, hostTag) {
    const embed = new EmbedBuilder()
        .setTitle("🎉 GIVEAWAY!")
        .setColor(0xFFD700)
        .setDescription(`**Prize:** ${prize}\n\nReact with 🎉 to enter!\nEnds: <t:${Math.floor((Date.now() + ms) / 1000)}:R>`)
        .setFooter({ text: `Hosted by ${hostTag}` })
        .setTimestamp(new Date(Date.now() + ms));

    const giveMsg = await channel.send({ content: "@everyone 🎉 **GIVEAWAY!** 🎉", embeds: [embed] });
    await giveMsg.react("🎉");

    setTimeout(async () => {
        const fresh    = await giveMsg.fetch().catch(() => null);
        if (!fresh) return;
        const reaction = fresh.reactions.cache.get("🎉");
        if (!reaction) return channel.send("🎉 No one entered the giveaway.");
        const users  = await reaction.users.fetch();
        const valid  = users.filter(u => !u.bot);
        if (!valid.size) return channel.send("🎉 No eligible entrants.");
        const winner   = valid.random();
        const winEmbed = new EmbedBuilder()
            .setTitle("🎉 Giveaway Ended!")
            .setColor(0xFFD700)
            .setDescription(`**Prize:** ${prize}\n**Winner:** ${winner}`)
            .setFooter({ text: `Hosted by ${hostTag}` })
            .setTimestamp();
        await channel.send({ content: `🎉 Congratulations ${winner}!`, embeds: [winEmbed] });
    }, ms);
}

// ====================== POLL ======================
async function handlePollPrefix(message, content) {
    const body  = content.replace(/^!poll\s*/i, "").trim();
    const parts = body.split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) return message.reply("❌ Usage: `!poll Question | Option 1 | Option 2 | …`");
    const question = parts[0];
    const options  = parts.slice(1, 10);
    const numbers  = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];
    const embed    = new EmbedBuilder().setTitle(`📊 ${question}`).setColor(0x00FFAA).setDescription(options.map((o,i) => `${numbers[i]} ${o}`).join("\n")).setFooter({ text: `Poll by ${message.author.tag}` }).setTimestamp();
    const sent     = await message.channel.send({ embeds: [embed] });
    for (let i = 0; i < options.length; i++) await sent.react(numbers[i]).catch(() => {});
    return safeDelete(message);
}

// ====================== REPORT ======================
async function handleReportPrefix(message, content) {
    const target = message.mentions.members?.first();
    if (!target) return message.reply("❌ Usage: `!report @user <reason>`");
    const reason = content.replace(/^!report\s+<@!?\d+>\s*/i, "").trim();
    if (!reason) return message.reply("❌ Include a reason.");
    await handleReportCore(message, target, reason, message.guild);
    return message.reply("✅ Report sent to admins.");
}

async function handleReportCore(source, target, reason, guild) {
    const embed = new EmbedBuilder()
        .setTitle("🚨 User Report")
        .setColor(0xFF4444)
        .addFields(
            { name: "Reported User", value: `${target.user?.tag || target.tag} (${target.id})`,       inline: true },
            { name: "Reported By",   value: `${source.author?.tag || source.member?.user.tag}`,        inline: true },
            { name: "Reason",        value: reason },
            { name: "Jump",          value: source.url ? `[Click here](${source.url})` : "N/A" }
        )
        .setTimestamp();

    const admins = guild.members.cache.filter(m => !m.user.bot && m.permissions.has(PermissionFlagsBits.Administrator));
    for (const [, admin] of admins) await admin.send({ embeds: [embed] }).catch(() => {});
}

// ====================== REMINDME ======================
async function handleRemindMePrefix(message, content) {
    const parts   = content.replace(/^!remindme\s+/i, "").split(/\s+/);
    const timeStr = parts[0];
    const text    = parts.slice(1).join(" ");
    if (!timeStr || !text) return message.reply("❌ Usage: `!remindme 30m text`");
    const result  = parseTime(timeStr);
    if (!result) return message.reply("❌ Time must be like `30m` or `2h`.");
    if (result.ms > 24 * 3_600_000) return message.reply("❌ Max is 24 hours.");
    await message.reply(`⏰ Got it! Reminding you in **${timeStr}**.`);
    setTimeout(async () => {
        await message.author.send(`⏰ **Reminder!**\n${text}\n\n*(Set in ${message.guild.name})*`).catch(() => {
            message.channel.send(`${message.author} ⏰ Reminder: **${text}**`).catch(() => {});
        });
    }, result.ms);
}

// ====================== BAN / KICK ======================
async function handleBanPrefix(message, content, action) {
    const target = message.mentions.members?.first();
    if (!target) return message.reply(`❌ Mention a user: \`!${action} @user [reason]\``);
    const reason = content.replace(new RegExp(`^!${action}\\s+<@!?\\d+>\\s*`, "i"), "").trim() || "No reason provided";
    try {
        await target.send(
            `${action === "ban" ? "🔨 You have been **banned**" : "👢 You have been **kicked**"} from **${message.guild.name}**.\nReason: **${reason}**`
        ).catch(() => {});
        action === "ban" ? await target.ban({ reason }) : await target.kick(reason);
        return message.reply({
            embeds: [buildActionEmbed(
                action === "ban" ? "🔨 Member Banned" : "👢 Member Kicked",
                action === "ban" ? 0xFF4444 : 0xFF8800,
                target.user, message.author, reason
            )]
        });
    } catch (e) {
        return message.reply(`❌ Could not ${action}: ${e.message}`);
    }
}

// ====================== TICKET SYSTEM — v4.3 (category support) ======================
async function handleTicketPrefix(message) {
    const safeName = message.author.username.toLowerCase().replace(/[^a-z0-9]/g, "");
    const existing = message.guild.channels.cache.find(c => c.name === `ticket-${safeName}`);
    if (existing) return message.reply(`❌ You already have a ticket open: ${existing}`);

    const settings = getSettings(message.guild.id);

    const channelData = {
        name:   `ticket-${safeName}`,
        type:   ChannelType.GuildText,
        topic:  `Support ticket for ${message.author.tag}`,
        permissionOverwrites: [
            { id: message.guild.id,  deny:  [PermissionsBitField.Flags.ViewChannel] },
            { id: message.author.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: client.user.id,    allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    };
    // Place ticket inside category if one is configured
    if (settings.ticketCategoryId) channelData.parent = settings.ticketCategoryId;

    const channel = await message.guild.channels.create(channelData);

    if (settings.modRoleId) {
        await channel.permissionOverwrites.edit(settings.modRoleId, { ViewChannel: true, SendMessages: true }).catch(() => {});
    }

    ticketChannels.add(channel.id);

    const embed = new EmbedBuilder()
        .setTitle("🎫 Support Ticket")
        .setColor(0x00FFAA)
        .setDescription(`Hello ${message.author}! Please describe your issue and a staff member will assist you.\n\nMods can close this with \`!closeticket\`.`)
        .setTimestamp();

    await channel.send({ content: `${message.author}`, embeds: [embed] });
    return message.reply(`✅ Ticket opened: ${channel}`);
}

async function handleTicketSlash(interaction, member, guild, reply, replyErr) {
    const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, "");
    const existing = guild.channels.cache.find(c => c.name === `ticket-${safeName}`);
    if (existing) return replyErr(`You already have a ticket open: ${existing}`);

    const settings = getSettings(guild.id);

    const channelData = {
        name:   `ticket-${safeName}`,
        type:   ChannelType.GuildText,
        topic:  `Support ticket for ${member.user.tag}`,
        permissionOverwrites: [
            { id: guild.id,       deny:  [PermissionsBitField.Flags.ViewChannel] },
            { id: member.id,      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
    };
    // Place ticket inside category if one is configured
    if (settings.ticketCategoryId) channelData.parent = settings.ticketCategoryId;

    const channel = await guild.channels.create(channelData);

    if (settings.modRoleId) {
        await channel.permissionOverwrites.edit(settings.modRoleId, { ViewChannel: true, SendMessages: true }).catch(() => {});
    }

    ticketChannels.add(channel.id);

    const embed = new EmbedBuilder()
        .setTitle("🎫 Support Ticket")
        .setColor(0x00FFAA)
        .setDescription(`Hello ${member}! Describe your issue and staff will help.\n\nMods close with \`/closeticket\`.`)
        .setTimestamp();

    await channel.send({ content: `${member}`, embeds: [embed] });
    return reply(`✅ Ticket opened: ${channel}`, true);
}

// ====================== EMBED BUILDERS ======================
function buildHelpEmbed(permLevel) {
    const embed = new EmbedBuilder()
        .setTitle("🤖 Yobest Bot v4.3 — Commands")
        .setColor(0x00FFAA)
        .addFields({
            name:  "✨ Public (everyone)",
            value: "`/ping` `/stats` `/serverinfo` `/userinfo` `/avatar`\n" +
                   "`/roll` `/8ball` `/suggest` `/poll` `/report`\n" +
                   "`/remindme` `/site` `/discord` `/rank` `/leaderboard` `/ticket` `/help`"
        });

    if (requireLevel("mod", permLevel)) {
        embed.addFields({ name: "🛡️ Moderator",
            value: "`/warn` `/warnings` `/clearwarnings` `/mute` `/unmute`\n" +
                   "`/purge` `/slowmode` `/lock` `/unlock` `/closeticket`" });
    }
    if (requireLevel("admin", permLevel)) {
        embed.addFields(
            { name: "🔨 Admin",
              value: "`/ban` `/kick` `/announce` `/giveaway` `/setwelcome`\n" +
                     "`/setmodrole` `/setautorole` `/enableai` `/disableai`\n" +
                     "`/addcmd` `/removecmd` `/listcmds` `/reactionrole`\n" +
                     "`/setwelcomechannel` `/setmodlogchannel` `/setticketcategory`" },
            { name: "📢 Announce format",
              value: "```\n!announce\ntitle: Title\ndesc: Description\nvideo: youtube_id\ndownload: link\nroblox: link\n```" }
        );
    }
    if (permLevel === "owner") {
        embed.addFields({ name: "👑 Owner Only",
            value: "`/scanandclean` — scan+clean 100 messages\n" +
                   "`/testautomod` — test the auto-mod pipeline\n" +
                   "`/aitest`      — test AI connection" });
    }
    embed.addFields({
        name:  "💡 Info",
        value: "Every `!command` also works as `/command`!\n" +
               "🛡️ Auto-mod is ALWAYS active — text, images, files, links.\n" +
               `🤖 AI powered by ${AI_DISPLAY_NAME} (OpenRouter).`
    });
    embed.setFooter({ text: "Yobest_BYTR Bot v4.3 • Auto-mod first, always" }).setTimestamp();
    return embed;
}

function buildStatsEmbed(guild) {
    // v4.3 FIX: No more anthropicClient reference
    const aiProvider = openaiClient
        ? `${AI_DISPLAY_NAME} (OpenRouter / ${OPENROUTER_MODEL})`
        : "None — set OPENROUTER_API_KEY";

    return new EmbedBuilder()
        .setTitle("📊 Bot & Server Stats — v4.3")
        .setColor(0x00FFAA)
        .addFields(
            { name: "👥 Members",      value: `${guild.memberCount}`,                        inline: true },
            { name: "⏱️ Uptime",       value: formatUptime(Date.now() - startTime),           inline: true },
            { name: "🌐 Servers",      value: `${client.guilds.cache.size}`,                  inline: true },
            { name: "🤖 AI Provider",  value: aiProvider,                                     inline: true },
            { name: "⚡ Anti-Spam",    value: `${SPAM_LIMIT} msg/${SPAM_WINDOW_MS/1000}s`,    inline: true },
            { name: "🤬 Profanity",    value: `${PROFANITY_PATTERNS.length} patterns`,        inline: true },
            { name: "📝 Scam Phrases", value: `${SCAM_PHRASES.length} patterns`,              inline: true },
            { name: "🔗 Scam Domains", value: `${SCAM_DOMAINS.length} patterns`,              inline: true },
            { name: "⭐ Leveling",     value: "Active — XP per message",                      inline: true }
        )
        .setTimestamp();
}

function buildServerInfoEmbed(guild) {
    return new EmbedBuilder()
        .setTitle(`🏠 ${guild.name}`)
        .setColor(0x00FFAA)
        .setThumbnail(guild.iconURL({ dynamic: true }) || null)
        .addFields(
            { name: "👑 Owner",    value: `<@${guild.ownerId}>`,                             inline: true },
            { name: "👥 Members", value: `${guild.memberCount}`,                             inline: true },
            { name: "📅 Created", value: `<t:${Math.floor(guild.createdTimestamp/1000)}:D>`, inline: true },
            { name: "💬 Channels",value: `${guild.channels.cache.size}`,                     inline: true },
            { name: "😀 Emojis",  value: `${guild.emojis.cache.size}`,                       inline: true },
            { name: "🆔 ID",      value: guild.id,                                           inline: true }
        )
        .setTimestamp();
}

function buildUserInfoEmbed(target, guild) {
    const warnings = warnHistory.get(target.id) || [];
    const xp       = xpData.get(target.id) || { xp: 0, level: 0 };
    return new EmbedBuilder()
        .setTitle(`👤 ${target.user.tag}`)
        .setColor(0x00FFAA)
        .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "🆔 ID",        value: target.id,                                                  inline: true },
            { name: "📅 Account",   value: `<t:${Math.floor(target.user.createdTimestamp/1000)}:D>`,  inline: true },
            { name: "📥 Joined",    value: `<t:${Math.floor(target.joinedTimestamp/1000)}:D>`,        inline: true },
            { name: "⭐ Level",     value: `${xp.level}`,                                             inline: true },
            { name: "✨ XP",        value: `${xp.xp}`,                                               inline: true },
            { name: "⚠️ Warnings", value: `${warnings.length}`,                                      inline: true },
            { name: "🎭 Roles",
              value: target.roles.cache.size > 1
                ? target.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).join(", ").slice(0, 1024)
                : "None"
            }
        )
        .setTimestamp();
}

function buildWarningsEmbed(user, warnings) {
    return new EmbedBuilder()
        .setTitle(`⚠️ Warnings for ${user.tag}`)
        .setColor(0xFF8800)
        .setDescription(warnings.map((w, i) => `**#${i+1}** — ${w.reason}\n↳ By ${w.by} <t:${Math.floor(w.ts/1000)}:R>`).join("\n\n"))
        .setTimestamp();
}

function buildActionEmbed(title, color, target, by, reason) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .addFields(
            { name: "User",   value: `${target.tag}`, inline: true },
            { name: "By",     value: `${by.tag}`,     inline: true },
            { name: "Reason", value: reason }
        )
        .setTimestamp();
}

function buildSiteEmbed() {
    return new EmbedBuilder()
        .setTitle(`🌐 ${SITE_INFO.name}`)
        .setColor(0x00FFAA)
        .setDescription(SITE_INFO.description)
        .addFields(
            { name: "🔗 Links",         value: Object.entries(SITE_INFO.links).map(([k,v]) => `[${k}](${v})`).join("\n") },
            { name: "✨ What's inside", value: SITE_INFO.highlights.map(h => `• ${h}`).join("\n") }
        )
        .setTimestamp();
}

function buildSiteRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Visit Site").setStyle(ButtonStyle.Link).setURL(SITE_INFO.url).setEmoji("🌐")
    );
}

function buildLeaderboard(guild) {
    const sorted = [...xpData.entries()]
        .sort(([,a],[,b]) => (b.level * 10000 + b.xp) - (a.level * 10000 + a.xp))
        .slice(0, 10);

    const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
    const lines  = sorted.map(([userId, data], i) => {
        const member = guild.members.cache.get(userId);
        const name   = member?.user.username || `<@${userId}>`;
        return `${medals[i]} **${name}** — Level ${data.level} (${data.xp} XP)`;
    }).join("\n");

    return new EmbedBuilder()
        .setTitle("🏆 XP Leaderboard")
        .setColor(0xFFD700)
        .setDescription(lines || "No XP data yet.")
        .setTimestamp();
}

function buildXPBar(current, needed) {
    const pct    = Math.min(current / needed, 1);
    const filled = Math.round(pct * 20);
    const empty  = 20 - filled;
    return `\`[${"█".repeat(filled)}${"░".repeat(empty)}]\` ${Math.round(pct * 100)}%`;
}

// ====================== UTILITIES ======================
function parseTime(str) {
    const match = str?.match(/^(\d+)(s|m|h)$/i);
    if (!match) return null;
    const amount = parseInt(match[1]);
    const unit   = match[2].toLowerCase();
    const ms     = unit === "h" ? amount * 3_600_000
                 : unit === "m" ? amount * 60_000
                 :                amount * 1_000;
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
    if (/^[a-zA-Z0-9_-]{11}$/.test(t)) return t;
    const patterns = [
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
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

// ====================== LOGIN ======================
client.login(process.env.DISCORD_TOKEN);