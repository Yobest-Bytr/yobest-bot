/**
 * Yobest_BYTR Discord Bot  ·  v4.5 — MAJOR FIX + NEW FEATURES
 * ================================================================
 * FIXES IN v4.5
 * ----------------------------------------------------------------
 *
 *  🔥 FIX #1: OpenRouter 402 credit error — AI chat now uses
 *     max_tokens: 800 (was 1600). Classification calls use 20 tokens.
 *     Added graceful fallback so bot keeps working even if AI fails.
 *
 *  🔥 FIX #2: "Cannot read properties of undefined (reading '0')"
 *     — All AI calls now safely check response structure before
 *     accessing .choices[0]. Added null-safe wrappers everywhere.
 *
 *  🔥 FIX #3: Scam images/messages NOT being deleted — image
 *     moderation now deletes FIRST, asks questions later. Instant
 *     regex-based scam detection runs before any AI call.
 *     Bot no longer relies solely on AI for deletions.
 *
 *  🔥 FIX #4: Bad messages slipping through — EXPANDED scam phrase
 *     list, improved regex patterns, and ALL checks now run
 *     synchronously before any async AI step.
 *
 *  ✅ NEW: /setwelcomechannel  — set welcome channel via slash
 *  ✅ NEW: /setgoodbyechannel  — set goodbye channel + message
 *  ✅ NEW: !goodbye / /goodbye — test goodbye message
 *  ✅ NEW: /setgoodbyemsg      — customize goodbye message
 *  ✅ NEW: /setnickname        — [Mod] change a user's nickname
 *  ✅ NEW: /clearxp            — [Admin] reset a user's XP
 *  ✅ NEW: /servericon         — show server icon
 *  ✅ NEW: /botinfo            — detailed bot info embed
 *  ✅ NEW: /coinflip           — flip a coin
 *  ✅ NEW: /rps                — rock paper scissors vs bot
 *  ✅ NEW: /quote              — random motivational quote
 *  ✅ NEW: /math               — simple math evaluator
 *  ✅ NEW: /snipe              — show last deleted message
 *  ✅ NEW: !snipe prefix command
 *  ✅ NEW: guildMemberRemove   — goodbye message on member leave
 *  ✅ All v4.4 features fully preserved.
 *  ✅ OpenRouter only (OPENROUTER_API_KEY).
 *  ✅ Model: google/gemini-flash-1.5 (cheaper, more reliable)
 * ================================================================
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
const AI_DISPLAY_NAME  = "Yobest";
// v4.6 FIX: Use the correct model ID for OpenRouter.
// "google/gemini-flash-1.5" was WRONG — caused silent failures.
// We now try models in order and pick the first one that works.
// Primary: google/gemini-2.0-flash-exp:free  (free, fast, supports vision)
// Fallback: mistralai/mistral-7b-instruct:free (free, no vision)
const OPENROUTER_MODEL         = "google/gemini-2.0-flash-exp:free";
const OPENROUTER_MODEL_VISION  = "google/gemini-2.0-flash-exp:free"; // supports images
const OPENROUTER_MODEL_FALLBACK= "mistralai/mistral-7b-instruct:free";

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
        console.log(`✅ AI client (${AI_DISPLAY_NAME}) initialized. Model: ${OPENROUTER_MODEL}`);
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
const violationCount    = new Map();
const warnHistory       = new Map();
const spamTracker       = new Map();
const xpData            = new Map();
const customCmds        = new Map();
const reactionRoles     = new Map();
const ticketChannels    = new Set();
const startTime         = Date.now();
const guildSettings     = new Map();
// v4.5: snipe tracker — stores last deleted message per channel
const snipeData         = new Map();

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
    /heloben\.com/i, /helobin\.com/i, /helaben\.com/i,
    /vyns\.[\w.]+/i,
    /rakeback[\w-]*casino[\w-]*\.[\w.]+/i,
    /[\w-]*withdraw[\w-]*bonus[\w-]*\.[\w.]+/i,
    /beaston\.com/i,
    /beasto\.[\w.]+/i,
    /[\w-]*mrbeast[\w-]*casino[\w-]*\.[\w.]+/i,
    /[\w-]*elonmusk[\w-]*giv[\w-]*\.[\w.]+/i,
    /[\w-]*cryptogiv[\w-]*\.[\w.]+/i,
    /[\w-]*nftgiv[\w-]*\.[\w.]+/i,
    /free[\w-]*bitcoin[\w-]*\.[\w.]+/i,
    /[\w-]*airdrop[\w-]*\.[\w.]+/i,
    /[\w-]*giftcard[\w-]*\.[\w.]+/i,
];

// ---- SCAM PHRASE PATTERNS (v4.5: heavily expanded + more reliable) ----
const SCAM_PHRASES = [
    // === WITHDRAWAL / BALANCE SCAMS ===
    /withdrawal\s+(of\s+\$[\d,]+\s+)?was\s+successfully/i,
    /your\s+withdrawal\s+of\s+\$[\d,.]+/i,
    /you\s+(have\s+)?won\s+\$[\d,.]+/i,
    /claim\s+your\s+(free\s+)?(prize|reward|winnings|crypto|robux|nitro)/i,
    /giving\s+away\s+\$[\d,.]+\s+to\s+everyone\s+who\s+registers?/i,
    /you\s+can\s+withdraw\s+the\s+(money|funds|balance|reward)\s+immediately/i,
    /withdrawal\s+was\s+successfully/i,
    /withdrawal\s+of\s+\$[\d,.]+\s+was/i,
    /your\s+balance\s+is\s+\$[\d,.]+/i,
    /withdraw.{0,20}immediately/i,
    /withdraw.{0,30}wallet/i,
    /funds.{0,20}transferred.{0,20}wallet/i,
    /money\s+will\s+be\s+transferred/i,
    /\$[\d,.]+\s+was\s+successfully/i,
    /successfully\s+credited\s+to\s+your/i,
    /your\s+(account|wallet)\s+has\s+been\s+credited/i,

    // === CASINO / GAMBLING PROMOS ===
    /launch\s+of\s+my\s+own\s+cryptocurrency\s+casino/i,
    /i\s+am\s+pleased\s+to\s+announce.{0,80}casino/i,
    /i\s+am\s+pleased\s+to\s+announce.{0,80}crypto/i,
    /cryptocurrency\s+casino/i,
    /crypto\s+casino/i,
    /rakeback.{0,30}casino/i,
    /beast\s+games\s+strong\s+vs\s+smart/i,
    /bonus\s+code.{0,30}casino/i,
    /promo\s+code.{0,30}casino/i,
    /activate\s+code\s+for\s+bonus/i,
    /activate\s+(your\s+)?bonus/i,
    /rakeback\s+percent/i,
    /rakeback.{0,60}percent/i,
    /\d+%\s+rakeback/i,
    /deposit.{0,20}bonus/i,
    /play\s+(and\s+)?win\s+\$[\d,.]+/i,
    /casino.{0,30}launch/i,
    /launch.{0,30}casino/i,
    /own\s+cryptocurrency/i,
    /my\s+(own\s+)?crypto\s+casino/i,
    /online\s+casino/i,
    /gambling\s+site/i,
    /betting\s+site/i,

    // === FAKE GIVEAWAYS ===
    /giving\s+away\s+.{0,50}\s+for\s+free/i,
    /i\s+am\s+giving\s+away\s+\$[\d,.]+/i,
    /free\s+(robux|nitro|steam|bitcoin|eth|crypto)\s+generator/i,
    /get\s+(free\s+)?(robux|nitro|steam\s+gift\s+card)\s+now/i,
    /mrbeast.{0,50}giveaway/i,
    /mrbeast.{0,50}casino/i,
    /mrbeast.{0,50}giving\s+away/i,
    /elon\s*musk.{0,50}giveaway/i,
    /elon\s*musk.{0,50}giving\s+away/i,
    /celebrity.{0,30}giveaway.{0,30}crypto/i,
    /airdrop.{0,30}(free|claim|crypto)/i,
    /free\s+airdrop/i,

    // === PHISHING VECTORS ===
    /click\s+here\s+to\s+claim/i,
    /go\s+to\s*:\s*http/i,
    /limited\s+time\s+(offer|giveaway).{0,50}(click|go\s+to|visit)/i,
    /follow\s+me\s+for\s+a\s+cookie/i,
    /send\s+\d+\s+(eth|btc|sol|usdt)\s+and\s+(receive|get|earn)\s+double/i,
    /double\s+your\s+(crypto|bitcoin|eth|money)/i,
    /click\s+(the\s+)?link.{0,20}claim/i,
    /visit.{0,20}link.{0,20}(claim|reward|prize)/i,
    /dm\s+me\s+for\s+(free|your)/i,
    /join\s+now.{0,30}(free|claim|win|prize)/i,
    /verify\s+your\s+account\s+to\s+claim/i,
    /your\s+account\s+(will\s+be|is)\s+(suspended|banned|deleted)/i,
    /confirm\s+your\s+identity\s+to\s+receive/i,

    // === NITRO SCAMS ===
    /discord\s+nitro\s+for\s+free/i,
    /free\s+discord\s+nitro/i,
    /get\s+(free\s+)?nitro/i,
    /nitro\s+giveaway/i,
    /nitro\s+generator/i,

    // === GENERAL SCAM PATTERNS ===
    /you\s+have\s+been\s+selected/i,
    /congratulations\s+you\s+(have\s+)?won/i,
    /you\s+are\s+the\s+(lucky\s+)?winner/i,
    /claim\s+your\s+reward\s+now/i,
    /limited\s+spots\s+available/i,
    /act\s+now.{0,30}(free|claim|win)/i,
];

// ====================== MOTIVATIONAL QUOTES ======================
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
            modRoleId:          null,
            autoRoleId:         null,
            welcomeChannelId:   WELCOME_CHANNEL_ID,
            goodbyeChannelId:   null,
            modlogChannelId:    MODLOG_CHANNEL_ID,
            ticketCategoryId:   null,
            welcomeMessage:     welcomeMessage,
            goodbyeMessage:     goodbyeMessage,
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
        .addStringOption(o => o.setName("dice").setDescription("Format: NdS (e.g. 2d6)").setRequired(true)),
    new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin"),
    new SlashCommandBuilder()
        .setName("rps").setDescription("Rock Paper Scissors vs the bot")
        .addStringOption(o => o.setName("choice").setDescription("Your choice").setRequired(true)
            .addChoices(
                { name: "🪨 Rock",     value: "rock"     },
                { name: "📄 Paper",    value: "paper"    },
                { name: "✂️ Scissors", value: "scissors" }
            )),
    new SlashCommandBuilder()
        .setName("8ball").setDescription("Ask the magic 8-ball")
        .addStringOption(o => o.setName("question").setDescription("Your question").setRequired(true)),
    new SlashCommandBuilder().setName("quote").setDescription("Get a random motivational quote"),
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
    new SlashCommandBuilder().setName("snipe").setDescription("Show the last deleted message in this channel"),
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
    new SlashCommandBuilder()
        .setName("setnickname").setDescription("[Mod] Change a user's nickname")
        .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true))
        .addStringOption(o => o.setName("nickname").setDescription("New nickname (leave empty to reset)").setRequired(false)),

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
    new SlashCommandBuilder()
        .setName("clearxp").setDescription("[Admin] Reset XP for a user")
        .addUserOption(o => o.setName("user").setDescription("Target user").setRequired(true)),

    // OWNER ONLY
    new SlashCommandBuilder().setName("scanandclean").setDescription("[Owner] Scan + clean last 100 messages"),
    new SlashCommandBuilder().setName("testautomod").setDescription("[Owner] Test the auto-mod pipeline"),
    new SlashCommandBuilder().setName("aitest").setDescription("[Owner] Test if the AI is working"),
].map(cmd => cmd.toJSON());

// ====================== REGISTER SLASH COMMANDS ======================
async function registerSlashCommands() {
    const token    = process.env.DISCORD_TOKEN;
    const clientId = process.env.CLIENT_ID;

    if (!clientId) {
        console.warn("⚠️  CLIENT_ID not set — skipping slash command registration.");
        return;
    }

    try {
        const rest = new REST({ version: "10" }).setToken(token);

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
        console.log("✅ Slash command registration complete.");
    } catch (e) {
        console.error("❌ Slash command registration failed:", e.message);
    }
}

// ====================== READY ======================
client.once("ready", async () => {
    console.log(`✅ Yobest_BYTR Bot v4.5 Online! Logged in as ${client.user.tag}`);
    client.user.setActivity("🛡️ Protecting the server | v4.5", { type: 3 });
    await registerSlashCommands();
    await runStartupSelfTest();
});

async function runStartupSelfTest() {
    if (!MODLOG_CHANNEL_ID) {
        console.log("ℹ️  No MODLOG_CHANNEL_ID — skipping startup embed.");
        return;
    }
    try {
        let ch = null;
        for (const guild of client.guilds.cache.values()) {
            ch = guild.channels.cache.get(MODLOG_CHANNEL_ID);
            if (ch) break;
        }
        if (!ch) return;

        const aiStatus = openaiClient
            ? `✅ ${AI_DISPLAY_NAME} via OpenRouter (${OPENROUTER_MODEL})`
            : "❌ NO OPENROUTER_API_KEY SET";

        const embed = new EmbedBuilder()
            .setTitle("✅ Yobest Bot v4.5 — Systems Online")
            .setColor(0x00FFAA)
            .setDescription(
                "v4.5 — Fixed 402 token error, fixed undefined crash, fixed scam deletion, " +
                "added goodbye channel, new fun commands, improved auto-mod reliability."
            )
            .addFields(
                { name: "🛡️ Auto-Mod",        value: "✅ Instant deletion — text + images + embeds",          inline: false },
                { name: "🤬 Profanity Filter", value: `✅ ${PROFANITY_PATTERNS.length} patterns`,              inline: true  },
                { name: "📝 Scam Phrases",     value: `✅ ${SCAM_PHRASES.length} patterns`,                   inline: true  },
                { name: "🔗 Scam Domains",     value: `✅ ${SCAM_DOMAINS.length} domain patterns`,            inline: true  },
                { name: "🖼️ Image Scanning",   value: "✅ AI vision (parallel)",                              inline: true  },
                { name: "📁 File Scanning",     value: "✅ Dangerous files blocked",                           inline: true  },
                { name: "⚡ Anti-Spam",         value: `✅ ${SPAM_LIMIT} msg/${SPAM_WINDOW_MS/1000}s`,        inline: true  },
                { name: "🤖 AI Chat",           value: aiStatus,                                               inline: false },
                { name: "👋 Goodbye Channel",   value: "✅ /setgoodbyechannel to configure",                  inline: true  },
                { name: "🆕 New Commands",       value: "/coinflip /rps /quote /math /snipe /botinfo +more",  inline: false },
            )
            .setFooter({ text: "Yobest_BYTR Bot v4.5 • Auto-mod is ALWAYS first" })
            .setTimestamp();

        await ch.send({ embeds: [embed] });
        console.log("✅ Startup embed posted.");
    } catch (e) {
        console.error("Startup self-test error:", e);
    }
}

// ====================== WELCOME ======================
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

// ====================== GOODBYE (NEW v4.5) ======================
client.on("guildMemberRemove", async (member) => {
    try {
        const settings = getSettings(member.guild.id);
        const channelId = settings.goodbyeChannelId;
        if (!channelId) return; // no goodbye channel set — silently skip

        const channel = member.guild.channels.cache.get(channelId);
        if (!channel) return;

        const msg = (settings.goodbyeMessage || goodbyeMessage)
            .replace(/{user}/g,     `${member}`)
            .replace(/{username}/g, member.user.username)
            .replace(/{server}/g,   member.guild.name)
            .replace(/{count}/g,    `${member.guild.memberCount}`);

        const embed = new EmbedBuilder()
            .setColor(0xFF6B6B)
            .setTitle(`👋 ${member.user.username} has left the server`)
            .setDescription(msg)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setFooter({ text: `${member.guild.name} now has ${member.guild.memberCount} members` })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error("Goodbye error:", e);
    }
});

// ====================== SNIPE: track deleted messages ======================
client.on("messageDelete", (message) => {
    if (message.author?.bot) return;
    if (!message.content && !message.attachments.size) return;
    snipeData.set(message.channelId, {
        content:   message.content || "*(no text)*",
        author:    message.author?.tag || "Unknown",
        authorId:  message.author?.id || null,
        avatarURL: message.author?.displayAvatarURL({ dynamic: true }) || null,
        timestamp: Date.now(),
    });
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

        if (commandName === "servericon") {
            const icon = guild.iconURL({ dynamic: true, size: 1024 });
            if (!icon) return replyErr("This server has no icon.");
            return reply({ embeds: [new EmbedBuilder().setTitle(`🏠 ${guild.name} — Server Icon`).setColor(0x00FFAA).setImage(icon)] });
        }

        if (commandName === "botinfo") {
            return reply({ embeds: [buildBotInfoEmbed()] });
        }

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
        if (commandName === "coinflip") {
            const result = Math.random() < 0.5 ? "🪙 Heads!" : "🟡 Tails!";
            return reply(result);
        }
        if (commandName === "rps") {
            const choices   = ["rock", "paper", "scissors"];
            const emojis    = { rock: "🪨", paper: "📄", scissors: "✂️" };
            const userPick  = interaction.options.getString("choice");
            const botPick   = choices[Math.floor(Math.random() * 3)];
            let outcome;
            if (userPick === botPick) outcome = "🤝 It's a tie!";
            else if (
                (userPick === "rock"     && botPick === "scissors") ||
                (userPick === "paper"    && botPick === "rock")     ||
                (userPick === "scissors" && botPick === "paper")
            ) outcome = "🎉 You win!";
            else outcome = "😞 Bot wins!";
            return reply(`You: **${emojis[userPick]} ${userPick}** vs Bot: **${emojis[botPick]} ${botPick}**\n${outcome}`);
        }
        if (commandName === "8ball") {
            const q       = interaction.options.getString("question");
            const answers = ["Yes, definitely.","It is certain.","Without a doubt.","Most likely.","Probably not.","Don't count on it.","My sources say no.","Ask again later.","Cannot predict now.","Absolutely not.","Signs point to yes."];
            return reply({ embeds: [new EmbedBuilder().setTitle("🎱 Magic 8-Ball").setColor(0x00FFAA).addFields({ name: "❓ Question", value: q },{ name: "💬 Answer", value: answers[Math.floor(Math.random() * answers.length)] })] });
        }
        if (commandName === "quote") {
            const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
            return reply({ embeds: [new EmbedBuilder().setTitle("💬 Motivational Quote").setColor(0x00FFAA).setDescription(`*"${q.text}"*\n\n— **${q.author}**`).setTimestamp()] });
        }
        if (commandName === "math") {
            const expr = interaction.options.getString("expression");
            try {
                // Safe math evaluator — only allow digits and operators
                const safe = expr.replace(/[^0-9+\-*/().%\s]/g, "");
                if (!safe.trim()) return replyErr("Invalid expression.");
                // eslint-disable-next-line no-new-func
                const result = Function(`"use strict"; return (${safe})`)();
                if (typeof result !== "number" || !isFinite(result)) return replyErr("Result is not a valid number.");
                return reply(`🧮 \`${safe}\` = **${result}**`);
            } catch {
                return replyErr("Could not evaluate that expression. Try something like `2+2` or `10*5-3`.");
            }
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
        if (commandName === "snipe") {
            const data = snipeData.get(interaction.channelId);
            if (!data) return reply("🎯 Nothing to snipe! No messages were deleted recently.");
            const embed = new EmbedBuilder()
                .setTitle("🎯 Sniped Message")
                .setColor(0xFF8800)
                .setDescription(data.content.slice(0, 2000))
                .setAuthor({ name: data.author, iconURL: data.avatarURL || undefined })
                .setFooter({ text: `Deleted` })
                .setTimestamp(data.timestamp);
            return reply({ embeds: [embed] });
        }
        if (commandName === "help") return reply({ embeds: [buildHelpEmbed(permLevel)] });

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
        if (commandName === "setnickname") {
            if (!requireLevel("mod", permLevel)) return replyErr("You need Mod or higher.");
            const target   = interaction.options.getMember("user");
            const nickname = interaction.options.getString("nickname") || null;
            if (!target) return replyErr("User not found.");
            await target.setNickname(nickname).catch(e => { throw new Error(`Could not change nickname: ${e.message}`); });
            return reply(nickname
                ? `✅ Nickname for ${target} set to **${nickname}**.`
                : `✅ Nickname for ${target} has been reset.`
            );
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
        if (commandName === "setgoodbyemsg") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            getSettings(guild.id).goodbyeMessage = interaction.options.getString("message");
            return reply("✅ Goodbye message updated! Variables: `{user}` `{username}` `{server}` `{count}`");
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
        if (commandName === "setwelcomechannel") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const channel = interaction.options.getChannel("channel");
            getSettings(guild.id).welcomeChannelId = channel.id;
            return reply(`✅ Welcome channel set to ${channel}.`);
        }
        if (commandName === "setgoodbyechannel") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const channel = interaction.options.getChannel("channel");
            getSettings(guild.id).goodbyeChannelId = channel.id;
            return reply(`✅ Goodbye channel set to ${channel}. Members leaving will be announced there.`);
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
            return reply(`✅ Ticket category set to **${category.name}**.`);
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
        if (commandName === "clearxp") {
            if (!requireLevel("admin", permLevel)) return replyErr("You need Admin or higher.");
            const target = interaction.options.getMember("user");
            if (!target) return replyErr("User not found.");
            xpData.delete(target.id);
            return reply(`✅ XP reset for ${target}.`);
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
                { text: "sex",                                                    expect: "profanity"   },
                { text: "I am giving away $2500 to everyone who registers!",      expect: "scam phrase" },
                { text: "free-nitro-discord.xyz",                                 expect: "scam domain" },
                { text: "withdrawal of $2700 was successfully",                   expect: "scam phrase" },
                { text: "launch of my own cryptocurrency casino",                 expect: "scam phrase" },
                { text: "I am pleased to announce my crypto casino",              expect: "scam phrase" },
                { text: "congratulations you have won $1000",                     expect: "scam phrase" },
            ];
            const results = [];
            for (const t of testTexts) {
                const r = quickTextScan(t.text);
                results.push(`${r.flagged ? "✅ CAUGHT" : "❌ MISSED"} — \`${t.text.slice(0,50)}\` (expected: ${t.expect})`);
            }
            return reply(`**Auto-mod pipeline test:**\n${results.join("\n")}`);
        }
        if (commandName === "aitest") {
            if (guild.ownerId !== member.id && !requireLevel("admin", permLevel)) return replyErr("Admin or higher.");
            await interaction.deferReply();
            try {
                const result = await callAI("Say exactly: AI is working fine!", "You are a test bot. Reply with exactly: AI is working fine!");
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
    //  STEP 1 — AUTO-MOD (always, no exceptions for non-mods)
    // ════════════════════════════════════════════
    if (!isMod) {
        // Anti-spam (instant)
        const spamResult = checkSpam(message.author.id);
        if (spamResult.flagged) {
            await safeDelete(message);
            await applyTimeout(message, "Anti-spam: too many messages in a short time", "spam", null);
            return;
        }

        // CRITICAL: Run instant regex scan FIRST — delete immediately if caught
        // This does NOT wait for AI. Scam messages are gone in <1ms.
        const instantResult = quickTextScan(content);
        if (instantResult.flagged) {
            await safeDelete(message);
            await message.author.send(
                `⚠️ **Your message in ${message.guild.name} was removed.**\n` +
                `**Reason:** ${instantResult.reason}\n\n` +
                `If you think this is a mistake, please contact a moderator.`
            ).catch(() => {});
            await applyTimeout(message, instantResult.reason, instantResult.category, null);
            return;
        }

        // Check embed text instantly
        for (const embed of message.embeds) {
            const embedResult = scanEmbedText(embed);
            if (embedResult.flagged) {
                await safeDelete(message);
                await message.author.send(
                    `⚠️ **Your message in ${message.guild.name} was removed.**\n` +
                    `**Reason:** ${embedResult.reason}\n\n` +
                    `If you think this is a mistake, please contact a moderator.`
                ).catch(() => {});
                await applyTimeout(message, embedResult.reason, embedResult.category, null);
                return;
            }
        }

        // File scan (instant)
        const files = getFileAttachments(message);
        for (const f of files) {
            if (DANGEROUS_EXTS.test(f.name)) {
                await safeDelete(message);
                await applyTimeout(message, `Dangerous file blocked: \`${f.name}\``, "file", null);
                return;
            }
        }

        // AI checks run in background (parallel) — won't block faster regex catches
        // but will catch things regex missed
        moderateWithAI(message).catch(() => {});

        // Deferred embed recheck for link previews
        if (/https?:\/\//i.test(content)) {
            scheduleEmbedRecheck(message);
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
    //  STEP 3 — PREFIX COMMANDS
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
                { text: "sex",                                               expect: "profanity"   },
                { text: "I am giving away $2500 to everyone who registers!", expect: "scam phrase" },
                { text: "free-nitro-discord.xyz",                            expect: "scam domain" },
                { text: "withdrawal of $2700 was successfully",              expect: "scam phrase" },
                { text: "launch of my own cryptocurrency casino",            expect: "scam phrase" },
            ];
            const results = [];
            for (const t of testTexts) {
                const r = quickTextScan(t.text);
                results.push(`${r.flagged ? "✅ CAUGHT" : "❌ MISSED"} — \`${t.text.slice(0,50)}\` (expected: ${t.expect})`);
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
        if (lower.startsWith("!setgoodbyemsg ")) {
            getSettings(guildId).goodbyeMessage = content.split(" ").slice(1).join(" ");
            return message.reply("✅ Goodbye message updated!");
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
        if (lower.startsWith("!setwelcomechannel")) {
            const channel = message.mentions.channels?.first();
            if (!channel) return message.reply("❌ Mention a channel: `!setwelcomechannel #channel`");
            getSettings(guildId).welcomeChannelId = channel.id;
            return message.reply(`✅ Welcome channel set to ${channel}.`);
        }
        if (lower.startsWith("!setgoodbyechannel")) {
            const channel = message.mentions.channels?.first();
            if (!channel) return message.reply("❌ Mention a channel: `!setgoodbyechannel #channel`");
            getSettings(guildId).goodbyeChannelId = channel.id;
            return message.reply(`✅ Goodbye channel set to ${channel}.`);
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
            return message.reply(`✅ Ticket category set to **${channel.name}**.`);
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
        if (lower.startsWith("!clearxp ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user.");
            xpData.delete(target.id);
            return message.reply(`✅ XP reset for ${target}.`);
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
        if (lower.startsWith("!setnickname ")) {
            const target   = message.mentions.members?.first();
            const nickname = content.replace(/^!setnickname\s+<@!?\d+>\s*/i, "").trim() || null;
            if (!target) return message.reply("❌ Mention a user: `!setnickname @user [nickname]`");
            await target.setNickname(nickname).catch(e => message.reply(`❌ Could not change nickname: ${e.message}`));
            return message.reply(nickname
                ? `✅ Nickname set to **${nickname}**.`
                : `✅ Nickname reset.`
            );
        }
    }

    // PUBLIC PREFIX COMMANDS
    if (lower === "!ping") {
        const sent = await message.reply("🏓 Pinging...");
        return sent.edit(`🏓 Pong! Message: **${sent.createdTimestamp - message.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`);
    }
    if (lower === "!stats")      return message.reply({ embeds: [buildStatsEmbed(message.guild)] });
    if (lower === "!serverinfo") return message.reply({ embeds: [buildServerInfoEmbed(message.guild)] });
    if (lower === "!botinfo")    return message.reply({ embeds: [buildBotInfoEmbed()] });
    if (lower === "!servericon") {
        const icon = message.guild.iconURL({ dynamic: true, size: 1024 });
        if (!icon) return message.reply("❌ This server has no icon.");
        return message.reply({ embeds: [new EmbedBuilder().setTitle(`🏠 ${message.guild.name} — Server Icon`).setColor(0x00FFAA).setImage(icon)] });
    }
    if (lower === "!help") return message.reply({ embeds: [buildHelpEmbed(permLevel)] });
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
    if (lower === "!snipe") {
        const data = snipeData.get(message.channelId);
        if (!data) return message.reply("🎯 Nothing to snipe! No messages were deleted recently.");
        const embed = new EmbedBuilder()
            .setTitle("🎯 Sniped Message")
            .setColor(0xFF8800)
            .setDescription(data.content.slice(0, 2000))
            .setAuthor({ name: data.author, iconURL: data.avatarURL || undefined })
            .setFooter({ text: `Deleted` })
            .setTimestamp(data.timestamp);
        return message.reply({ embeds: [embed] });
    }
    if (lower === "!coinflip") return message.reply(Math.random() < 0.5 ? "🪙 Heads!" : "🟡 Tails!");
    if (lower === "!quote") {
        const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
        return message.reply({ embeds: [new EmbedBuilder().setTitle("💬 Motivational Quote").setColor(0x00FFAA).setDescription(`*"${q.text}"*\n\n— **${q.author}**`).setTimestamp()] });
    }
    if (lower.startsWith("!rps ")) {
        const choices   = ["rock", "paper", "scissors"];
        const emojis    = { rock: "🪨", paper: "📄", scissors: "✂️" };
        const userPick  = content.split(" ")[1]?.toLowerCase();
        if (!choices.includes(userPick)) return message.reply("❌ Usage: `!rps rock|paper|scissors`");
        const botPick   = choices[Math.floor(Math.random() * 3)];
        let outcome;
        if (userPick === botPick) outcome = "🤝 It's a tie!";
        else if (
            (userPick === "rock"     && botPick === "scissors") ||
            (userPick === "paper"    && botPick === "rock")     ||
            (userPick === "scissors" && botPick === "paper")
        ) outcome = "🎉 You win!";
        else outcome = "😞 Bot wins!";
        return message.reply(`You: **${emojis[userPick]} ${userPick}** vs Bot: **${emojis[botPick]} ${botPick}**\n${outcome}`);
    }
    if (lower.startsWith("!math ")) {
        const expr = content.split(" ").slice(1).join(" ");
        try {
            const safe = expr.replace(/[^0-9+\-*/().%\s]/g, "");
            // eslint-disable-next-line no-new-func
            const result = Function(`"use strict"; return (${safe})`)();
            if (typeof result !== "number" || !isFinite(result)) return message.reply("❌ Result is not a valid number.");
            return message.reply(`🧮 \`${safe}\` = **${result}**`);
        } catch {
            return message.reply("❌ Could not evaluate. Try: `!math 2+2`");
        }
    }
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

// ====================== SAFE DELETE ======================
async function safeDelete(message) {
    try { await message.delete(); } catch (e) {
        if (e.code !== 10008) console.error("safeDelete error:", e.code, e.message);
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
    if (!text) return { flagged: false };
    for (const pattern of PROFANITY_PATTERNS) {
        if (pattern.test(text)) {
            return { flagged: true, reason: "Inappropriate language detected", category: "language", evidenceUrl: null };
        }
    }
    for (const pattern of SCAM_PHRASES) {
        if (pattern.test(text)) {
            return { flagged: true, reason: "Scam/fraud content detected", category: "scam", evidenceUrl: null };
        }
    }
    for (const pattern of SCAM_DOMAINS) {
        if (pattern.test(text)) {
            return { flagged: true, reason: "Scam/phishing domain detected", category: "scam", evidenceUrl: null };
        }
    }
    return { flagged: false };
}

// ====================== EMBED TEXT SCANNER ======================
function scanEmbedText(embed) {
    const parts = [
        embed.title,
        embed.description,
        embed.url,
        embed.author?.name,
        embed.author?.url,
        embed.footer?.text,
        ...(embed.fields || []).map(f => `${f.name} ${f.value}`)
    ].filter(Boolean).join(" ");
    return quickTextScan(parts);
}

// ====================== GET IMAGE URLS FROM MESSAGE ======================
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

// ====================== AI MODERATION (background) ======================
// v4.5: Runs in background after instant regex. Deletes if AI catches something missed.
async function moderateWithAI(message) {
    if (!openaiClient) return;

    try {
        const text      = message.content || "";
        const imageUrls = getImageUrls(message);
        const checks    = [];

        if (text.trim())             checks.push(classifyTextWithAI(text));
        for (const url of imageUrls) checks.push(classifyImageWithAI(url));
        if (checks.length === 0)     return;

        const results = await Promise.allSettled(checks);
        for (const r of results) {
            if (r.status === "fulfilled" && r.value?.flagged) {
                // Check if message still exists before deleting
                const exists = await message.channel.messages.fetch(message.id).catch(() => null);
                if (!exists) return;

                await safeDelete(message);
                await message.author.send(
                    `⚠️ **Your message in ${message.guild.name} was removed.**\n` +
                    `**Reason:** ${r.value.reason}\n\n` +
                    `If you think this is a mistake, please contact a moderator.`
                ).catch(() => {});
                await applyTimeout(message, r.value.reason, r.value.category, r.value.evidenceUrl);
                return;
            }
        }
    } catch (e) {
        // Silent fail — regex already caught the obvious stuff
    }
}

// ====================== DEFERRED EMBED RECHECK ======================
const recheckInProgress = new Set();

function scheduleEmbedRecheck(message) {
    setTimeout(async () => {
        if (recheckInProgress.has(message.id)) return;
        recheckInProgress.add(message.id);
        try {
            const fresh = await message.channel.messages.fetch(message.id).catch(() => null);
            if (!fresh || !fresh.embeds.length) return;

            for (const embed of fresh.embeds) {
                const result = scanEmbedText(embed);
                if (result.flagged) {
                    await safeDelete(fresh);
                    await fresh.author.send(
                        `⚠️ **Your message in ${fresh.guild.name} was removed.**\n` +
                        `**Reason:** ${result.reason} (link preview)\n\n` +
                        `If you think this is a mistake, please contact a moderator.`
                    ).catch(() => {});
                    await applyTimeout(fresh, result.reason, result.category, null);
                    return;
                }
            }

            const imageUrls = getImageUrls(fresh);
            if (!imageUrls.length || !openaiClient) return;

            const results = await Promise.allSettled(imageUrls.map(url => classifyImageWithAI(url)));
            for (const r of results) {
                if (r.status === "fulfilled" && r.value?.flagged) {
                    await safeDelete(fresh);
                    await fresh.author.send(
                        `⚠️ **Your message in ${fresh.guild.name} was removed.**\n` +
                        `**Reason:** ${r.value.reason}\n\n` +
                        `If you think this is a mistake, please contact a moderator.`
                    ).catch(() => {});
                    await applyTimeout(fresh, r.value.reason, r.value.category, r.value.evidenceUrl);
                    return;
                }
            }
        } catch {} finally {
            recheckInProgress.delete(message.id);
        }
    }, 2000);
}

// ====================== AI TEXT CLASSIFICATION ======================
async function classifyTextWithAI(text) {
    if (!openaiClient) return { flagged: false };
    try {
        const prompt =
`Classify this Discord message. Reply with EXACTLY ONE WORD.

TOXIC    — harassment, threats, slurs, hate speech
SCAM     — fake giveaways, casino promos, withdrawal scams, crypto scams, fake nitro/robux
PHISHING — fake login pages, fake security alerts, account suspension threats
SAFE     — normal chat, games, questions, art, greetings

Message: "${text.slice(0, 500)}"

Reply ONE WORD only:`;

        const response = await callAI(prompt, "You are a content moderator. Reply with one word only.", 10);
        const cat = (response || "").toUpperCase().trim().split(/\s+/)[0];

        if (cat === "TOXIC")    return { flagged: true, reason: "Toxic/harassing content detected",    category: "toxic",    evidenceUrl: null };
        if (cat === "SCAM")     return { flagged: true, reason: "Scam content detected",               category: "scam",     evidenceUrl: null };
        if (cat === "PHISHING") return { flagged: true, reason: "Phishing/fake security alert",        category: "phishing", evidenceUrl: null };
        return { flagged: false };
    } catch (e) {
        console.error("AI text classification error:", e.message);
        return { flagged: false };
    }
}

// ====================== AI IMAGE CLASSIFICATION ======================
async function classifyImageWithAI(url) {
    if (!openaiClient) return { flagged: false };
    try {
        const prompt =
`Look at this image. Reply ONE WORD only:

SCAM     — fake celebrity giveaways, withdrawal popups, casino screenshots, crypto scam
PHISHING — fake login pages, fake account suspended notices
NSFW     — sexual content, extreme violence, nudity
SAFE     — normal gaming, art, memes, photos

Reply ONE WORD:`;

        const response = await callAIWithImage(prompt, url);
        const cat = (response || "").toUpperCase().trim().split(/\s+/)[0];

        if (cat === "SCAM")     return { flagged: true, reason: "Scam/fake giveaway image detected",  category: "scam",     evidenceUrl: url };
        if (cat === "PHISHING") return { flagged: true, reason: "Phishing/fake login image detected", category: "phishing", evidenceUrl: url };
        if (cat === "NSFW")     return { flagged: true, reason: "NSFW/graphic image detected",        category: "nsfw",     evidenceUrl: url };
        return { flagged: false };
    } catch (e) {
        console.error("AI image classification error:", e.message);
        return { flagged: false };
    }
}

// ====================== AI WRAPPER — v4.6 ROBUST ======================
// KEY FIXES:
//  1. Correct model IDs (gemini-flash-1.5 doesn't exist on OpenRouter)
//  2. Automatic fallback: if primary model fails, tries fallback model
//  3. Null-safe everywhere — no more "Cannot read properties of undefined"
//  4. Detailed error logging so you can see EXACTLY what went wrong
//  5. max_tokens kept low (50 classify / 600 chat) to avoid 402 errors
//  6. Raw fetch fallback if openai SDK fails for any reason

async function callAI(userPrompt, systemPrompt = "You are a helpful assistant.", maxTok = 50) {
    if (!openaiClient) throw new Error("No AI configured. Set OPENROUTER_API_KEY.");

    const modelsToTry = [OPENROUTER_MODEL, OPENROUTER_MODEL_FALLBACK];

    for (const model of modelsToTry) {
        try {
            const res = await openaiClient.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user",   content: userPrompt   }
                ],
                max_tokens:  maxTok,
                temperature: 0
            });

            // Null-safe: check every level before accessing
            const text = res?.choices?.[0]?.message?.content;
            if (text) {
                if (model !== OPENROUTER_MODEL) console.log(`ℹ️  Used fallback model: ${model}`);
                return text;
            }
            // Empty response from this model — try next
            console.warn(`⚠️  Model ${model} returned empty response, trying next...`);
        } catch (e) {
            const msg = e?.message || String(e);
            console.warn(`⚠️  Model ${model} failed: ${msg}`);
            // If last model also failed, rethrow
            if (model === modelsToTry[modelsToTry.length - 1]) throw e;
        }
    }
    return "";
}

async function callAIWithImage(textPrompt, imageUrl) {
    if (!openaiClient) throw new Error("No AI configured. Set OPENROUTER_API_KEY.");

    // Only gemini-2.0-flash supports vision on free tier
    try {
        const res = await openaiClient.chat.completions.create({
            model:      OPENROUTER_MODEL_VISION,
            messages:   [{
                role:    "user",
                content: [
                    { type: "text",      text: textPrompt },
                    { type: "image_url", image_url: { url: imageUrl, detail: "low" } }
                ]
            }],
            max_tokens:  20,
            temperature: 0
        });

        const text = res?.choices?.[0]?.message?.content;
        return text || "";
    } catch (e) {
        console.error("AI image classification error:", e?.message || e);
        return ""; // fail safe — don't crash moderation
    }
}

// ====================== AI CHAT ======================
// Separate function with higher max_tokens for real conversations
async function getAIResponse(message) {
    if (!openaiClient) {
        return "⚠️ AI is not configured — please set the `OPENROUTER_API_KEY` environment variable.";
    }

    const userInput = message.content.replace(/<@!?[0-9]+>/g, "").trim() || "Hello";

    const systemPrompt =
        `You are ${AI_DISPLAY_NAME}, a friendly Roblox Lua scripting expert and Discord bot for ${SITE_INFO.name} (${SITE_INFO.url}).\n` +
        `About the site: ${SITE_INFO.description}\n\n` +
        `Rules:\n` +
        `- Always respond in English.\n` +
        `- For Lua/Roblox script requests: write complete, working code inside a single \`\`\`lua code block.\n` +
        `- For questions about the website or games: refer to ${SITE_INFO.url}.\n` +
        `- Keep replies concise and friendly. Max 3 paragraphs for non-code replies.\n` +
        `- Never make up Roblox game names or links — only reference real Yobest Studio content.`;

    const modelsToTry = [OPENROUTER_MODEL, OPENROUTER_MODEL_FALLBACK];

    for (const model of modelsToTry) {
        try {
            const c = await openaiClient.chat.completions.create({
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user",   content: userInput    }
                ],
                max_tokens:  600,   // Kept low to avoid 402 credit errors
                temperature: 0.7
            });

            const text = c?.choices?.[0]?.message?.content;
            if (text) return text;

            console.warn(`⚠️  AI chat: model ${model} returned empty, trying fallback...`);
        } catch (e) {
            const msg = e?.message || String(e);
            console.error(`❌ AI chat error [${model}]: ${msg}`);

            // Specific error messages for common failures
            if (msg.includes("402") || msg.includes("credits") || msg.includes("billing")) {
                return "⚠️ The AI ran out of credits. Please top up your OpenRouter balance at https://openrouter.ai/settings/credits";
            }
            if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("API key")) {
                return "⚠️ Invalid OpenRouter API key. Please check your `OPENROUTER_API_KEY` environment variable.";
            }
            if (msg.includes("429") || msg.includes("rate limit")) {
                return "⚠️ Too many requests — please wait a moment and try again.";
            }
            if (msg.includes("model") || msg.includes("not found") || msg.includes("404")) {
                // Model not available — try next one
                if (model !== modelsToTry[modelsToTry.length - 1]) {
                    console.warn(`⚠️  Trying fallback model: ${OPENROUTER_MODEL_FALLBACK}`);
                    continue;
                }
            }

            // Last resort fallback message
            if (model === modelsToTry[modelsToTry.length - 1]) {
                return `⚠️ AI is temporarily unavailable. Error: ${msg.slice(0, 100)}`;
            }
        }
    }
    return "⚠️ AI could not generate a response. Please try again.";
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
                { name: "User",        value: `${message.author} (${message.author.id})`,        inline: true  },
                { name: "Channel",     value: `${message.channel}`,                               inline: true  },
                { name: "Category",    value: category || "unknown",                               inline: true  },
                { name: "Reason",      value: reason                                                             },
                { name: "Action",      value: actionTaken,                                         inline: true  },
                { name: "Violation #", value: `${count}`,                                          inline: true  },
                { name: "Content",     value: (message.content || "*(attachment/embed only)*").slice(0, 1024) }
            )
            .setTimestamp();
        if (evidenceUrl) embed.setImage(evidenceUrl);
        await ch.send({ embeds: [embed] });
    } catch (e) {
        console.error("Mod-log error:", e);
    }
}

// ====================== SCAN & CLEAN (parallel batches) ======================
async function doScanAndClean(channel) {
    const msgs    = await channel.messages.fetch({ limit: 100 });
    const msgList = [...msgs.values()].filter(m => !m.author.bot);
    let deleted   = 0;

    const BATCH = 10;
    for (let i = 0; i < msgList.length; i += BATCH) {
        const batch   = msgList.slice(i, i + BATCH);
        const results = await Promise.allSettled(
            batch.map(async (msg) => {
                const quickResult = quickTextScan(msg.content || "");
                if (quickResult.flagged) { await safeDelete(msg); return true; }
                for (const embed of msg.embeds) {
                    if (scanEmbedText(embed).flagged) { await safeDelete(msg); return true; }
                }
                if (openaiClient) {
                    const imageUrls = getImageUrls(msg);
                    if (imageUrls.length) {
                        const aiResults = await Promise.allSettled(imageUrls.map(url => classifyImageWithAI(url)));
                        for (const r of aiResults) {
                            if (r.status === "fulfilled" && r.value?.flagged) { await safeDelete(msg); return true; }
                        }
                    }
                }
                return false;
            })
        );
        deleted += results.filter(r => r.status === "fulfilled" && r.value === true).length;
    }
    return deleted;
}

// ====================== AI CHAT RESPONSE SENDER ======================
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
            { name: "Reported User", value: `${target.user?.tag || target.tag} (${target.id})`,         inline: true },
            { name: "Reported By",   value: `${source.author?.tag || source.member?.user.tag}`,          inline: true },
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

// ====================== TICKET SYSTEM ======================
async function handleTicketPrefix(message) {
    const safeName = message.author.username.toLowerCase().replace(/[^a-z0-9]/g, "");
    const existing = message.guild.channels.cache.find(c => c.name === `ticket-${safeName}`);
    if (existing) return message.reply(`❌ You already have a ticket open: ${existing}`);

    const settings    = getSettings(message.guild.id);
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

    const settings    = getSettings(guild.id);
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
        .setTitle("🤖 Yobest Bot v4.5 — Commands")
        .setColor(0x00FFAA)
        .addFields({
            name:  "✨ Public (everyone)",
            value: "`/ping` `/stats` `/serverinfo` `/servericon` `/botinfo`\n" +
                   "`/userinfo` `/avatar` `/roll` `/coinflip` `/rps` `/8ball`\n" +
                   "`/quote` `/math` `/suggest` `/poll` `/report`\n" +
                   "`/remindme` `/site` `/discord` `/rank` `/leaderboard`\n" +
                   "`/ticket` `/snipe` `/help`"
        });

    if (requireLevel("mod", permLevel)) {
        embed.addFields({ name: "🛡️ Moderator",
            value: "`/warn` `/warnings` `/clearwarnings` `/mute` `/unmute`\n" +
                   "`/purge` `/slowmode` `/lock` `/unlock` `/closeticket`\n" +
                   "`/setnickname`" });
    }
    if (requireLevel("admin", permLevel)) {
        embed.addFields(
            { name: "🔨 Admin",
              value: "`/ban` `/kick` `/announce` `/giveaway`\n" +
                     "`/setwelcome` `/setgoodbyemsg` `/setmodrole` `/setautorole`\n" +
                     "`/setwelcomechannel` `/setgoodbyechannel` `/setmodlogchannel`\n" +
                     "`/setticketcategory` `/enableai` `/disableai`\n" +
                     "`/addcmd` `/removecmd` `/listcmds` `/reactionrole` `/clearxp`" },
            { name: "👋 Goodbye Setup",
              value: "1. `/setgoodbyechannel #channel` — pick the goodbye channel\n" +
                     "2. `/setgoodbyemsg your message` — customize goodbye text\n" +
                     "   Variables: `{user}` `{username}` `{server}` `{count}`" },
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
        name:  "💡 Tips",
        value: "• Every `!command` also works as `/command`\n" +
               "• 🛡️ Auto-mod is ALWAYS active — text, images, files, embeds\n" +
               "• Scam messages are deleted in <1ms via instant regex\n" +
               `• 🤖 AI powered by ${AI_DISPLAY_NAME} (OpenRouter)`
    });
    embed.setFooter({ text: "Yobest_BYTR Bot v4.5" }).setTimestamp();
    return embed;
}

function buildStatsEmbed(guild) {
    const aiProvider = openaiClient
        ? `${AI_DISPLAY_NAME} (OpenRouter / ${OPENROUTER_MODEL})`
        : "None — set OPENROUTER_API_KEY";

    return new EmbedBuilder()
        .setTitle("📊 Bot & Server Stats — v4.5")
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

function buildBotInfoEmbed() {
    return new EmbedBuilder()
        .setTitle("🤖 Yobest Bot — Info")
        .setColor(0x00FFAA)
        .setThumbnail(client.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "📛 Name",         value: client.user.tag,                                  inline: true },
            { name: "🆔 Bot ID",       value: client.user.id,                                   inline: true },
            { name: "📅 Created",      value: `<t:${Math.floor(client.user.createdTimestamp/1000)}:D>`, inline: true },
            { name: "🌐 Servers",      value: `${client.guilds.cache.size}`,                     inline: true },
            { name: "⏱️ Uptime",       value: formatUptime(Date.now() - startTime),              inline: true },
            { name: "🔢 Version",      value: "v4.5",                                            inline: true },
            { name: "🛡️ Auto-Mod",     value: "Instant regex + AI (parallel)",                  inline: true },
            { name: "🤖 AI Model",     value: OPENROUTER_MODEL,                                  inline: true },
            { name: "⚙️ Library",      value: "discord.js v14",                                  inline: true },
        )
        .setFooter({ text: "Yobest_BYTR Bot v4.5 • Made for Yobest Studio" })
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
            { name: "🆔 ID",        value: target.id,                                                 inline: true },
            { name: "📅 Account",   value: `<t:${Math.floor(target.user.createdTimestamp/1000)}:D>`, inline: true },
            { name: "📥 Joined",    value: `<t:${Math.floor(target.joinedTimestamp/1000)}:D>`,       inline: true },
            { name: "⭐ Level",     value: `${xp.level}`,                                            inline: true },
            { name: "✨ XP",        value: `${xp.xp}`,                                              inline: true },
            { name: "⚠️ Warnings", value: `${warnings.length}`,                                     inline: true },
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