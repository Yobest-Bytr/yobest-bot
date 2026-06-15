/**
 * Yobest_BYTR Discord Bot
 * ========================================================
 * FEATURES OVERVIEW
 * --------------------------------------------------------
 *  - Global smart moderation (ALWAYS ON):
 *      -> Bad words filter
 *      -> AI-based detection of toxicity, scams, phishing,
 *         "free robux" / "free items" scam links, suspicious
 *         Discord invite spam, etc.
 *      -> Deletes flagged messages + warn/timeout system
 *      -> Logs every action to a mod-log channel
 *
 *  - !enableai / !disableai
 *      -> Toggles ONLY the AI chat-response feature
 *      -> Moderation is unaffected
 *
 *  - AI Roblox Lua script generation
 *      -> Always returns FULL, uncut ```lua code blocks
 *      -> Auto-continues if a script gets cut off
 *      -> Sent as a clean embed intro + code block(s)
 *
 *  - !site
 *      -> Tells users about https://yobest-bytr.vercel.app/
 *      -> AI also uses this info automatically when asked
 *
 *  - !help / !announce (admin)
 *  - !scanandclean (owner)
 *  - New utility & fun: !ping, !stats, !serverinfo, !userinfo,
 *    !avatar, !roll, !8ball, !suggest
 *  - Welcome system on member join
 * ========================================================
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

// Optional: set channel IDs via env vars, or leave null to disable that feature
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || null;
const MODLOG_CHANNEL_ID = process.env.MODLOG_CHANNEL_ID || null;

// ====================== SITE KNOWLEDGE ======================
// Edit this block whenever your site changes. The AI uses this
// as context so it can answer questions about Yobest Studio.
// (No public API was available on the site, so this is kept
// up to date manually — update links/highlights as needed.)
const SITE_INFO = {
    name: "Yobest Studio",
    url: "https://yobest-bytr.vercel.app/",
    description:
        "Yobest Studio is a hub for Roblox games, AI tools, and a creator community. " +
        "It showcases Roblox game projects made by the Yobest/BYTR team, lets players " +
        "find links to play those games, and connects players with the community and updates.",
    // Add/edit links below as your site grows
    links: {
        "Website": "https://yobest-bytr.vercel.app/",
    },
    // Add short blurbs about specific games/sections here as needed
    highlights: [
        "Browse Roblox games made by the Yobest/BYTR team",
        "Find download/play links for the latest releases",
        "Join the community for updates and announcements"
    ]
};

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
            .setDescription(
                `Hey ${member}, welcome to **${member.guild.name}**!\n` +
                `We now have **${member.guild.memberCount}** members.\n\n` +
                `🔗 Check out our site: ${SITE_INFO.url}`
            )
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
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50`\nGlobal smart auto-moderation is always active (bad words, toxicity, scams, phishing links)." },
                    { name: "🌐 Site", value: "`!site` — info & links for Yobest Studio" },
                    { name: "✨ Utility", value: "`!ping` — bot latency\n`!stats` — server & bot stats\n`!serverinfo` — server details\n`!userinfo [@user]` — user details\n`!avatar [@user]` — show avatar" },
                    { name: "🎉 Fun", value: "`!roll [NdN]` — roll dice (e.g. `!roll 2d6`)\n`!8ball <question>` — magic 8-ball\n`!suggest <text>` — submit a suggestion" },
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

    // ====================== GLOBAL SMART MODERATION (ALWAYS ACTIVE) ======================
    const modResult = await moderateMessage(message);
    if (modResult.flagged) {
        await message.delete().catch(() => {});
        await applyTimeout(message, modResult.reason, modResult.category);
        return;
    }

    // ====================== UTILITY & FUN COMMANDS (anyone can use) ======================

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
                { name: "🛡️ Moderation", value: "Always Active (smart AI + filters)", inline: true }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // ---- !serverinfo ----
    if (lower === "!serverinfo") {
        const guild = message.guild;
        const embed = new EmbedBuilder()
            .setTitle(`🏠 ${guild.name}`)
            .setColor(0x00FFAA)
            .setThumbnail(guild.iconURL({ dynamic: true }) || null)
            .addFields(
                { name: "👑 Owner", value: `<@${guild.ownerId}>`, inline: true },
                { name: "👥 Members", value: `${guild.memberCount}`, inline: true },
                { name: "📅 Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
                { name: "💬 Channels", value: `${guild.channels.cache.size}`, inline: true },
                { name: "😀 Emojis", value: `${guild.emojis.cache.size}`, inline: true },
                { name: "🆔 Server ID", value: guild.id, inline: true }
            )
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // ---- !userinfo [@user] ----
    if (lower === "!userinfo" || lower.startsWith("!userinfo ")) {
        const target = message.mentions.members?.first() || message.member;
        const embed = new EmbedBuilder()
            .setTitle(`👤 ${target.user.tag}`)
            .setColor(0x00FFAA)
            .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: "🆔 User ID", value: target.id, inline: true },
                { name: "📅 Account Created", value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:D>`, inline: true },
                { name: "📥 Joined Server", value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:D>`, inline: true },
                { name: "🎭 Roles", value: target.roles.cache.size > 1 ? target.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(", ") : "None" }
            )
            .setTimestamp();
        return message.reply({ embeds: [embed] });
    }

    // ---- !avatar [@user] ----
    if (lower === "!avatar" || lower.startsWith("!avatar ")) {
        const target = message.mentions.users?.first() || message.author;
        const embed = new EmbedBuilder()
            .setTitle(`🖼️ ${target.tag}'s Avatar`)
            .setColor(0x00FFAA)
            .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
        return message.reply({ embeds: [embed] });
    }

    // ---- !roll [NdN] ----
    if (lower === "!roll" || lower.startsWith("!roll ")) {
        const arg = content.split(" ")[1] || "1d6";
        const match = arg.match(/^(\d+)d(\d+)$/i);

        if (!match) return message.reply("❌ Usage: `!roll 2d6` (rolls two 6-sided dice)");

        const count = Math.min(parseInt(match[1]), 100);
        const sides = Math.min(parseInt(match[2]), 1000);

        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
        const total = rolls.reduce((a, b) => a + b, 0);

        return message.reply(`🎲 Rolling **${count}d${sides}**: [${rolls.join(", ")}] → Total: **${total}**`);
    }

    // ---- !8ball ----
    if (lower === "!8ball" || lower.startsWith("!8ball ")) {
        const question = content.split(" ").slice(1).join(" ");
        if (!question) return message.reply("❌ Usage: `!8ball <your question>`");

        const answers = [
            "Yes, definitely.", "It is certain.", "Without a doubt.", "Most likely.",
            "Probably not.", "Don't count on it.", "My sources say no.",
            "Ask again later.", "Cannot predict now.", "Absolutely not.", "Signs point to yes."
        ];
        const answer = answers[Math.floor(Math.random() * answers.length)];

        const embed = new EmbedBuilder()
            .setTitle("🎱 Magic 8-Ball")
            .setColor(0x00FFAA)
            .addFields(
                { name: "❓ Question", value: question },
                { name: "💬 Answer", value: answer }
            );
        return message.reply({ embeds: [embed] });
    }

    // ---- !suggest ----
    if (lower === "!suggest" || lower.startsWith("!suggest ")) {
        const suggestion = content.split(" ").slice(1).join(" ");
        if (!suggestion) return message.reply("❌ Usage: `!suggest <your idea>`");

        const embed = new EmbedBuilder()
            .setTitle("💡 New Suggestion")
            .setColor(0x00FFAA)
            .setDescription(suggestion)
            .setFooter({ text: `Suggested by ${message.author.tag}` })
            .setTimestamp();

        const sent = await message.channel.send({ embeds: [embed] });
        await sent.react("👍").catch(() => {});
        await sent.react("👎").catch(() => {});
        return message.delete().catch(() => {});
    }

    // ---- !site ----
    if (lower === "!site") {
        const embed = new EmbedBuilder()
            .setTitle(`🌐 ${SITE_INFO.name}`)
            .setColor(0x00FFAA)
            .setDescription(SITE_INFO.description)
            .addFields(
                { name: "🔗 Links", value: Object.entries(SITE_INFO.links).map(([k, v]) => `[${k}](${v})`).join("\n") },
                { name: "✨ What you'll find", value: SITE_INFO.highlights.map(h => `• ${h}`).join("\n") }
            )
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Visit Site").setStyle(ButtonStyle.Link).setURL(SITE_INFO.url).setEmoji("🌐")
        );

        return message.reply({ embeds: [embed], components: [row] });
    }

    // ====================== AI CHAT (ONLY WHEN ENABLED) ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        const shouldReply = message.mentions.has(client.user) ||
            lower.includes("yobest") || lower.includes("bot") ||
            lower.includes("script") || lower.includes("code") ||
            lower.includes("site") || lower.includes("website") ||
            lower.includes("hello") || lower.includes("hi");

        if (shouldReply) {
            const thinking = await message.reply("🤔 **Yobest is thinking...**");
            const response = await getAIResponse(message);
            await thinking.delete().catch(() => {});
            if (response) await sendAIResponse(message, response);
        }
    }
});

// ====================== SMART MODERATION ======================

/**
 * Checks a message for:
 *  - Bad/profane words (fast regex check)
 *  - AI-based detection of toxicity, scams, phishing, and
 *    suspicious "free Robux/items" or fake-giveaway links
 *
 * Returns: { flagged: bool, reason: string, category: string }
 */
async function moderateMessage(message) {
    const text = message.content;

    // ---- Fast regex: profanity ----
    const badWords = /fuck|sex|shit|bitch|asshole|cunt|fucker|damn|bastard/i;
    if (badWords.test(text)) {
        return { flagged: true, reason: "Inappropriate language", category: "language" };
    }

    if (!text.trim()) return { flagged: false };

    // ---- AI check: toxicity + scams + phishing ----
    try {
        const res = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages: [{
                role: "user",
                content:
`Classify this Discord message into exactly ONE category. Reply with ONLY the category word, nothing else.

Categories:
- TOXIC (insults, harassment, hate speech, threats)
- SCAM (free robux/nitro/items, fake giveaways, "click this link to get X free", impersonation, crypto/investment scams)
- PHISHING (suspicious links pretending to be Discord/Roblox login, steam, account verification, "your account will be banned unless...")
- SAFE (normal message, no issues)

Message: "${text}"`
            }],
            max_tokens: 5
        });

        const category = (res.choices[0].message.content || "").toUpperCase().trim();

        if (category.includes("TOXIC")) {
            return { flagged: true, reason: "Toxic / harassing message", category: "toxic" };
        }
        if (category.includes("SCAM")) {
            return { flagged: true, reason: "Scam content (fake giveaway / free items link)", category: "scam" };
        }
        if (category.includes("PHISH")) {
            return { flagged: true, reason: "Phishing link / fake account warning", category: "phishing" };
        }
        return { flagged: false };
    } catch {
        return { flagged: false }; // fail safe: don't block messages if AI check fails
    }
}

/**
 * Applies a warning, then a 10-minute timeout on repeat offenses.
 * Also logs the action to the mod-log channel (if configured).
 */
async function applyTimeout(message, reason, category) {
    const userId = message.author.id;
    const count = (violationCount.get(userId) || 0) + 1;
    violationCount.set(userId, count);

    let actionTaken = "Warned";

    if (count >= 2) {
        await message.member.timeout(10 * 60 * 1000, reason).catch(() => {});
        message.channel.send(`⛔ ${message.author} has been timed out for 10 minutes. Reason: **${reason}**`).catch(() => {});
        actionTaken = "Timed out (10m)";
    } else {
        message.channel.send(`⚠️ ${message.author}, your message was removed. Reason: **${reason}**`).catch(() => {});
    }

    await logToModChannel(message, reason, category, actionTaken, count);
}

/**
 * Sends a detailed log entry to the mod-log channel, if configured.
 */
async function logToModChannel(message, reason, category, actionTaken, count) {
    if (!MODLOG_CHANNEL_ID) return;

    try {
        const logChannel = message.guild.channels.cache.get(MODLOG_CHANNEL_ID);
        if (!logChannel) return;

        const categoryEmojis = {
            language: "🤬",
            toxic: "☢️",
            scam: "🎭",
            phishing: "🎣"
        };

        const embed = new EmbedBuilder()
            .setTitle(`${categoryEmojis[category] || "🛡️"} Message Removed`)
            .setColor(0xFF4444)
            .addFields(
                { name: "User", value: `${message.author} (${message.author.id})`, inline: true },
                { name: "Channel", value: `${message.channel}`, inline: true },
                { name: "Category", value: category || "unknown", inline: true },
                { name: "Reason", value: reason },
                { name: "Action Taken", value: actionTaken, inline: true },
                { name: "Violation Count", value: `${count}`, inline: true },
                { name: "Original Content", value: message.content.slice(0, 1000) || "*(empty/embed/attachment)*" }
            )
            .setTimestamp();

        await logChannel.send({ embeds: [embed] });
    } catch (e) {
        console.error("Mod-log error:", e);
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

    const systemPrompt = `You are Yobest, a professional Roblox Lua scripting expert and the assistant for ${SITE_INFO.name} (${SITE_INFO.url}).

SITE INFO (use this if asked about the website, games, or links):
${SITE_INFO.description}
Links: ${Object.entries(SITE_INFO.links).map(([k, v]) => `${k}: ${v}`).join(", ")}
Highlights: ${SITE_INFO.highlights.join("; ")}

RULES:
- Always respond in English.
- If the user asks for any script:
  - ALWAYS return the COMPLETE, production-ready code inside a single fenced block:
    \`\`\`lua
    -- full script here
    \`\`\`
  - Never truncate, summarize, or say "rest of the code here".
  - Write clean, working, well-commented Lua code.
- If the user asks about the website/games/links, answer using the SITE INFO above. If you don't know specific details (like a live game list), point them to ${SITE_INFO.url} for the most current info.
- If the user is just chatting, respond normally, concisely, and in a friendly tone.`;

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
 * Sends the AI's response in a clean, cohesive way:
 *  - If it contains a Lua code block, sends an intro embed with
 *    any text before the code, then the code block(s) (split to
 *    fit Discord's limit, fences preserved across chunks).
 *  - If it's plain text, sends it normally (split if too long).
 */
async function sendAIResponse(message, text) {
    const MAX_LENGTH = 1900;
    const codeBlockMatch = text.match(/```lua[\s\S]*?```/);

    if (codeBlockMatch) {
        const codeBlock = codeBlockMatch[0];
        const introText = text.slice(0, codeBlockMatch.index).trim();
        const afterText = text.slice(codeBlockMatch.index + codeBlock.length).trim();

        // Send intro as an embed (if there's any explanation text)
        if (introText) {
            const embed = new EmbedBuilder()
                .setTitle("📜 Script Ready")
                .setColor(0x00FFAA)
                .setDescription(introText.slice(0, 4000));
            await message.reply({ embeds: [embed] });
        }

        // Send the code block(s), split if too long, fences preserved
        const codeChunks = splitWithFences(codeBlock, MAX_LENGTH);
        const totalParts = codeChunks.length;
        for (let i = 0; i < codeChunks.length; i++) {
            const label = totalParts > 1 ? `**Part ${i + 1}/${totalParts}**\n` : "";
            await message.channel.send(label + codeChunks[i]);
        }

        // Send any trailing explanation text
        if (afterText) {
            await sendPlainText(message, afterText, MAX_LENGTH);
        }
        return;
    }

    // No code block: just send as plain text (split if needed)
    await sendPlainText(message, text, MAX_LENGTH);
}

/**
 * Sends plain text, splitting on newlines if it exceeds MAX_LENGTH.
 */
async function sendPlainText(message, text, maxLength) {
    if (text.length <= maxLength) {
        return message.reply(text);
    }

    let remaining = text;
    let first = true;
    while (remaining.length > 0) {
        let splitIndex = remaining.length > maxLength
            ? remaining.lastIndexOf("\n", maxLength)
            : remaining.length;
        if (splitIndex <= 0) splitIndex = Math.min(maxLength, remaining.length);

        const chunk = remaining.slice(0, splitIndex);
        if (first) {
            await message.reply(chunk);
            first = false;
        } else {
            await message.channel.send(chunk);
        }
        remaining = remaining.slice(splitIndex).trim();
    }
}

/**
 * Splits a single fenced code block (```lua ... ```) into multiple
 * chunks under maxLength, re-opening/closing the fence on each chunk
 * so every chunk renders as valid Lua code in Discord.
 */
function splitWithFences(codeBlock, maxLength) {
    // Strip outer fences to get raw code
    const inner = codeBlock.replace(/^```lua\n?/, "").replace(/```$/, "");
    const fenceOverhead = "```lua\n\n```".length;
    const effectiveMax = maxLength - fenceOverhead;

    if (inner.length <= effectiveMax) {
        return [codeBlock];
    }

    const lines = inner.split("\n");
    const chunks = [];
    let current = "";

    for (const line of lines) {
        if ((current + line + "\n").length > effectiveMax) {
            chunks.push(current);
            current = "";
        }
        current += line + "\n";
    }
    if (current) chunks.push(current);

    return chunks.map(c => "```lua\n" + c.trimEnd() + "\n```");
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
            if (!msg.author.bot) {
                const result = await moderateMessage(msg);
                if (result.flagged) {
                    await msg.delete().catch(() => {});
                    deleted++;
                }
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