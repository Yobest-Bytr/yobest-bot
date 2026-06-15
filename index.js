/**
 * Yobest_BYTR Discord Bot
 * --------------------------------------------------
 * Features:
 *  - Global moderation (bad words + AI toxicity check) -> delete + timeout, ALWAYS ON
 *  - !enableai / !disableai -> toggles ONLY the AI chat-response feature
 *  - AI Roblox Lua script generation (full, uncut ```lua blocks)
 *  - !help, !announce (admin)
 *  - !scanandclean (owner)
 *  - New: !ping, welcome system, !stats
 * --------------------------------------------------
 */

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require("discord.js");
const OpenAI = require("openai");

// ====================== CLIENT SETUP ======================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMembers // required for welcome messages
    ]
});

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
});

// ====================== STATE ======================
const aiEnabledChannels = new Set(); // channels where AI chat replies are enabled
const violationCount = new Map();    // userId -> warning count
const startTime = Date.now();        // for uptime in !stats

// Optional: set a channel ID for welcome messages (or leave null to disable)
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || null;

// ====================== READY ======================
client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online! Logged in as ${client.user.tag}`);
});

// ====================== WELCOME SYSTEM ======================
client.on("guildMemberAdd", async (member) => {
    try {
        const channel = WELCOME_CHANNEL_ID
            ? member.guild.channels.cache.get(WELCOME_CHANNEL_ID)
            : member.guild.systemChannel; // fallback to system channel

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle("👋 Welcome!")
            .setDescription(`Hey ${member}, welcome to **${member.guild.name}**!\nWe now have **${member.guild.memberCount}** members.`)
            .setColor(0x00FFAA)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error("Welcome message error:", e);
    }
});

// ====================== MESSAGE HANDLER ======================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // ====================== OWNER COMMANDS ======================
    if (isOwner && lower === "!scanandclean") return scanAndCleanChannel(message);

    // ====================== ADMIN COMMANDS ======================
    if (isAdmin) {
        // ---- !help ----
        if (lower === "!help") {
            const embed = new EmbedBuilder()
                .setTitle("🤖 Yobest Bot Commands")
                .setColor(0x00FFAA)
                .setDescription("Here's everything I can do:")
                .addFields(
                    { name: "📢 Announcement", value: "`!announce title|desc|yt_id|download|roblox`\nPosts an update announcement with download/play buttons." },
                    { name: "🧠 AI Chat", value: "`!enableai` — enable AI chat replies in this channel\n`!disableai` — disable AI chat replies\n(Moderation stays active regardless)" },
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50`\nGlobal auto-moderation is always active." },
                    { name: "✨ Utility", value: "`!ping` — check bot latency\n`!stats` — view server & bot stats" },
                    { name: "👑 Owner", value: "`!scanandclean` — scan & delete bad messages from the last 100" }
                )
                .setFooter({ text: "Yobest_BYTR Bot" })
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        // ---- !announce ----
        if (lower.startsWith("!announce ")) {
            const args = content.slice(10).split("|").map(s => s.trim());
            if (args.length < 5) {
                return message.reply("❌ Usage: `!announce title|description|youtube_id|download_url|roblox_url`");
            }

            const [title, description, ytId, downloadUrl, robloxUrl] = args;

            const embed = new EmbedBuilder()
                .setTitle(`🚨 ${title}`)
                .setDescription(description)
                .setColor(0x00FFAA)
                .setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`)
                .addFields(
                    { name: "⬇️ Download", value: `[Click Here](${downloadUrl})` },
                    { name: "🎮 Play Roblox", value: `[Play Now](${robloxUrl})` }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(downloadUrl).setEmoji("📥"),
                new ButtonBuilder().setLabel("Play Roblox").setStyle(ButtonStyle.Link).setURL(robloxUrl).setEmoji("🎮")
            );

            await message.channel.send({
                content: "@everyone @here 🚨 **New Update by BYTR** 🚨",
                embeds: [embed],
                components: [row]
            });
            return message.reply("✅ Announcement posted successfully!");
        }

        // ---- !enableai (only toggles AI chat replies) ----
        if (lower === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ **AI Chat Replies Enabled** in this channel.\n(🛡️ Moderation is always active, regardless of this setting.)");
        }

        // ---- !disableai ----
        if (lower === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("❌ AI Chat Replies Disabled in this channel.\n(🛡️ Moderation remains active.)");
        }
    }

    // ====================== GLOBAL MODERATION (ALWAYS ACTIVE) ======================
    if (await moderateMessage(message)) {
        await message.delete().catch(() => {});
        await applyTimeout(message);
        return;
    }

    // ====================== UTILITY COMMANDS (anyone can use) ======================

    // ---- !ping ----
    if (lower === "!ping") {
        const sent = await message.reply("🏓 Pinging...");
        const latency = sent.createdTimestamp - message.createdTimestamp;
        const apiLatency = Math.round(client.ws.ping);
        return sent.edit(`🏓 Pong! Message latency: **${latency}ms** | API latency: **${apiLatency}ms**`);
    }

    // ---- !stats ----
    if (lower === "!stats") {
        const uptimeMs = Date.now() - startTime;
        const uptimeStr = formatUptime(uptimeMs);

        const embed = new EmbedBuilder()
            .setTitle("📊 Bot & Server Stats")
            .setColor(0x00FFAA)
            .addFields(
                { name: "🏠 Server Members", value: `${message.guild.memberCount}`, inline: true },
                { name: "⏱️ Bot Uptime", value: uptimeStr, inline: true },
                { name: "🌐 Servers Connected", value: `${client.guilds.cache.size}`, inline: true },
                { name: "🧠 AI Chat Status", value: aiEnabledChannels.has(message.channel.id) ? "Enabled here" : "Disabled here", inline: true },
                { name: "🛡️ Moderation", value: "Always Active", inline: true }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ====================== AI CHAT (ONLY WHEN ENABLED) ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        const shouldReply = message.mentions.has(client.user) ||
            lower.includes("yobest") || lower.includes("bot") ||
            lower.includes("script") || lower.includes("code") ||
            lower.includes("hello") || lower.includes("hi");

        if (shouldReply) {
            const thinking = await message.reply("🤔 **Yobest is thinking...**");

            const response = await getAIResponse(message);
            await thinking.delete().catch(() => {});

            if (response) await sendLongMessage(message, response);
        }
    }
});

// ====================== MODERATION HELPERS ======================

/**
 * Checks a message for bad words or AI-detected toxicity.
 * Returns true if the message should be deleted.
 */
async function moderateMessage(message) {
    const badWords = /fuck|sex|shit|bitch|asshole|cunt|fucker|damn|bastard/i;
    if (badWords.test(message.content)) return true;

    // Skip AI check on empty/whitespace-only content (e.g. attachments only)
    if (!message.content.trim()) return false;

    try {
        const res = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages: [{ role: "user", content: `Bad language or toxic? Answer only YES or NO.\n${message.content}` }],
            max_tokens: 5
        });
        return res.choices[0].message.content.toUpperCase().includes("YES");
    } catch {
        return false; // fail safe: don't block messages if AI check fails
    }
}

/**
 * Applies a warning, then a 10-minute timeout on repeat offenses.
 */
async function applyTimeout(message) {
    const userId = message.author.id;
    const count = (violationCount.get(userId) || 0) + 1;
    violationCount.set(userId, count);

    if (count >= 2) {
        await message.member.timeout(10 * 60 * 1000, "Bad language").catch(() => {});
        message.channel.send(`⛔ ${message.author} has been timed out for 10 minutes.`).catch(() => {});
    } else {
        message.channel.send(`⚠️ ${message.author} No bad words allowed!`).catch(() => {});
    }
}

// ====================== AI CHAT / SCRIPT GENERATION ======================

/**
 * Gets a response from the AI model.
 * If the response appears to be a Lua script that got cut off
 * (unbalanced ``` fences), it requests a continuation and merges it.
 */
async function getAIResponse(message) {
    const userInput = message.content.replace(/<@!?[0-9]+>/g, "").trim() || "Hello";

    const systemPrompt = `You are Yobest, a professional Roblox Lua scripting expert.
Always respond in English.

If the user asks for any script:
- ALWAYS return the COMPLETE, production-ready code inside a single fenced block:
\`\`\`lua
-- full script here
\`\`\`
- Never truncate, summarize, or say "rest of the code here".
- Write clean, working, well-commented Lua code.

If the user is just chatting, respond normally and concisely.`;

    try {
        let fullText = await requestCompletion(systemPrompt, userInput);

        // If the response contains an unclosed ```lua block, request the rest
        let attempts = 0;
        while (hasUnclosedCodeBlock(fullText) && attempts < 3) {
            attempts++;
            const continuation = await requestCompletion(
                systemPrompt,
                `Continue the previous Lua script EXACTLY where it left off. Do not repeat earlier code, do not add explanations, and make sure to close the \`\`\`lua block at the end.\n\nPrevious output:\n${fullText}`
            );
            fullText += "\n" + continuation;
        }

        return fullText;
    } catch (e) {
        console.error(e);
        return "I'm having trouble connecting to AI. Please try again.";
    }
}

/**
 * Single completion request to the AI model.
 */
async function requestCompletion(systemPrompt, userInput) {
    const completion = await openai.chat.completions.create({
        model: "google/gemini-3.5-flash",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userInput }
        ],
        max_tokens: 1600,
        temperature: 0.7
    });

    return completion.choices[0].message.content || "";
}

/**
 * Returns true if the text contains an odd number of ``` fences,
 * meaning a code block was opened but never closed.
 */
function hasUnclosedCodeBlock(text) {
    const fenceCount = (text.match(/```/g) || []).length;
    return fenceCount % 2 !== 0;
}

/**
 * Splits long AI responses into multiple messages to stay under
 * Discord's 2000-character limit, without breaking code fences mid-block.
 */
async function sendLongMessage(message, text) {
    const MAX_LENGTH = 1900;

    if (text.length <= MAX_LENGTH) {
        return message.reply(text);
    }

    const chunks = [];
    let remaining = text;

    while (remaining.length > MAX_LENGTH) {
        let splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
        if (splitIndex === -1) splitIndex = MAX_LENGTH;

        chunks.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex);
    }
    chunks.push(remaining);

    // Re-balance ``` fences across chunks so each chunk renders correctly
    let openFence = false;
    for (let i = 0; i < chunks.length; i++) {
        const fenceCount = (chunks[i].match(/```/g) || []).length;
        const closesOpenFence = openFence && fenceCount % 2 === 1;

        if (openFence && !closesOpenFence) {
            chunks[i] = "```lua\n" + chunks[i];
        }
        if ((fenceCount % 2 === 1) !== closesOpenFence) {
            chunks[i] += "\n```";
        }

        if (fenceCount % 2 === 1) openFence = !openFence;
    }

    for (const chunk of chunks) {
        await message.reply(chunk);
    }
}

// ====================== UTILITY ======================

function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / (1000 * 60)) % 60;
    const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));

    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// ====================== OWNER: SCAN & CLEAN ======================

async function scanAndCleanChannel(message) {
    await message.reply("🔍 Scanning last 100 messages...");
    try {
        const msgs = await message.channel.messages.fetch({ limit: 100 });
        let deleted = 0;
        for (const msg of msgs.values()) {
            if (!msg.author.bot && await moderateMessage(msg)) {
                await msg.delete().catch(() => {});
                deleted++;
            }
        }
        await message.channel.send(`✅ Deleted **${deleted}** bad messages.`);
    } catch (e) {
        console.error(e);
        await message.channel.send("❌ Scan error.");
    }
}

// ====================== LOGIN ======================
client.login(process.env.DISCORD_TOKEN);