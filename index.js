const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require("discord.js");
const OpenAI = require("openai");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildModeration
    ]
});

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        'HTTP-Referer': 'https://yobest-bytr.vercel.app',
        'X-OpenRouter-Title': 'Yobest BYTR Bot',
    },
});

const aiEnabledChannels = new Set();

client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // ====================== OWNER & ADMIN COMMANDS ======================
    if (isOwner && lower === "!scanandclean") {
        return await scanAndCleanChannel(message);
    }

    if (isAdmin) {
        if (lower === "!help") {
            const embed = new EmbedBuilder()
                .setTitle("🤖 Yobest Bot Commands")
                .setColor(0x00FFAA)
                .addFields(
                    { name: "📢 Announcement", value: "`!announce title|desc|yt_id|download|roblox`" },
                    { name: "🧠 AI", value: "`!enableai` | `!disableai`" },
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50` | `!warn @user`" },
                    { name: "👑 Owner", value: "`!scanandclean`" }
                );
            return message.reply({ embeds: [embed] });
        }

        if (lower.startsWith("!announce ")) { /* Keep your announce function */ 
            // ... (same as previous version - omitted for brevity)
        }

        if (lower === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ **AI Enabled** in this channel.");
        }
        if (lower === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("❌ **AI Disabled** in this channel.");
        }
    }

    // ====================== AI INTERACTION ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        const shouldDelete = await moderateMessage(message);
        if (shouldDelete) {
            await message.delete().catch(() => {});
            return message.channel.send("⚠️ Inappropriate message removed.");
        }

        const isMentioned = message.mentions.has(client.user);
        const containsTrigger = lower.includes("yobest") || lower.includes("bot") || lower.includes("help") || lower.includes("code") || lower.includes("script");

        if (isMentioned || containsTrigger || lower.startsWith("hello")) {
            // React to show processing
            await message.react("❤️").catch(() => {});

            const response = await getAIResponse(message);
            if (response) {
                const reply = await message.reply(response);

                // Create Thread for better conversation
                if (lower.includes("script") || lower.includes("code") || lower.includes("help")) {
                    try {
                        await reply.startThread({
                            name: `Discussion - ${message.author.username}`,
                            autoArchiveDuration: 1440, // 24 hours
                        });
                    } catch (e) {}
                }
            }
        }
    }
});

async function moderateMessage(message) {
    try {
        const res = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages: [{ role: "user", content: `Is this message toxic, spam, scam, NSFW or rule-breaking? Answer ONLY YES or NO.\nMessage: ${message.content.substring(0, 500)}` }],
            max_tokens: 10
        });
        return res.choices[0].message.content.toUpperCase().includes("YES");
    } catch { return false; }
}

async function getAIResponse(message) {
    const userInput = message.content.replace(`<@${client.user.id}>`, "").trim() || "Hello";

    const messages = [
        { 
            role: "system", 
            content: `You are Yobest, a professional and friendly Roblox Lua scripting expert.
Always respond in clear English.
**Always** put code inside proper markdown code blocks like this:
\`\`\`lua
-- your code here
\`\`\`
Be detailed, clean, and well-commented. Use best practices.` 
        },
        { role: "user", content: userInput }
    ];

    // Image support
    if (message.attachments.size > 0) {
        const imageParts = Array.from(message.attachments.values())
            .filter(att => att.contentType?.startsWith("image/"))
            .map(att => ({ type: "image_url", image_url: { url: att.url } }));

        if (imageParts.length > 0) {
            messages.push({
                role: "user",
                content: [{ type: "text", text: "Please analyze this image and help with the Roblox script:" }, ...imageParts]
            });
        }
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 900,
            temperature: 0.65
        });
        return completion.choices[0].message.content;
    } catch (err) {
        console.error(err);
        return "I'm here to help! What Roblox script do you need?";
    }
}

async function scanAndCleanChannel(message) {
    await message.reply("🔍 Scanning last 100 messages...");
    try {
        const fetched = await message.channel.messages.fetch({ limit: 100 });
        let count = 0;
        for (const msg of fetched.values()) {
            if (msg.author.bot) continue;
            if (await moderateMessage(msg)) {
                await msg.delete().catch(() => {});
                count++;
            }
        }
        await message.channel.send(`✅ Scan finished. Deleted **${count}** bad messages.`);
    } catch (e) {
        await message.channel.send("❌ Scan error.");
    }
}

client.login(process.env.DISCORD_TOKEN);