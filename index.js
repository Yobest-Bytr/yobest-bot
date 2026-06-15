const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
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
const violationCount = new Map();
const reactions = ["❤️", "👍", "🎮", "💡", "🔥"];

client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online: ${client.user.tag}`);
});

// ====================== GLOBAL MODERATION (Always Active) ======================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // Commands
    if (isOwner && lower === "!scanandclean") {
        return await scanAndCleanChannel(message);
    }

    if (isAdmin) {
        if (lower === "!help") {
            const embed = new EmbedBuilder()
                .setTitle("🤖 Yobest Bot Commands")
                .setColor(0x00FFAA)
                .addFields(
                    { name: "📢 Announcement", value: "`!announce ...`" },
                    { name: "🧠 AI Chat", value: "`!enableai` | `!disableai`" },
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50`" },
                    { name: "👑 Owner", value: "`!scanandclean`" }
                );
            return message.reply({ embeds: [embed] });
        }

        if (lower === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ **AI Chat Enabled** in this channel (Moderation is always active).");
        }
        if (lower === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("❌ **AI Chat Disabled** in this channel.");
        }
    }

    // === GLOBAL MODERATION (Always On) ===
    const isBad = await moderateMessage(message);
    if (isBad) {
        await message.delete().catch(() => {});
        await applyTimeout(message);
        return;
    }

    // === AI CHAT (Only if enabled in channel) ===
    if (aiEnabledChannels.has(message.channel.id)) {
        const isMentioned = message.mentions.has(client.user);
        const hasTrigger = lower.includes("yobest") || lower.includes("bot") || 
                          lower.includes("script") || lower.includes("code") || 
                          lower.includes("help") || lower.startsWith("hi") || lower.startsWith("hello");

        if (isMentioned || hasTrigger || Math.random() < 0.6) {
            const thinkingMsg = await message.reply("🤔 **Yobest is thinking...**");

            const randomEmoji = reactions[Math.floor(Math.random() * reactions.length)];
            await message.react(randomEmoji).catch(() => {});

            const response = await getAIResponse(message);
            await thinkingMsg.delete().catch(() => {});

            if (response) {
                const reply = await message.reply(response);
                if (lower.includes("script") || lower.includes("code")) {
                    try {
                        await reply.startThread({ name: `Script Help - ${message.author.username}`, autoArchiveDuration: 1440 });
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
            messages: [{ 
                role: "user", 
                content: `Does this message contain bad language, swear words (fuck, sex, shit, bitch, etc.), toxicity, spam or NSFW? Answer ONLY YES or NO.\nMessage: ${message.content.substring(0, 700)}` 
            }],
            max_tokens: 10
        });
        return res.choices[0].message.content.toUpperCase().trim().includes("YES");
    } catch { return false; }
}

async function applyTimeout(message) {
    const userId = message.author.id;
    const count = (violationCount.get(userId) || 0) + 1;
    violationCount.set(userId, count);

    try {
        if (count >= 2) {
            await message.member.timeout(10 * 60 * 1000, "Bad language");
            await message.channel.send(`⛔ ${message.author} has been timed out for 10 minutes for bad language.`);
        } else {
            await message.channel.send(`⚠️ ${message.author} No swearing allowed!`);
        }
    } catch (e) {}
}

async function getAIResponse(message) {
    const userInput = message.content.replace(`<@${client.user.id}>`, "").trim() || "Hello";

    const messages = [
        { 
            role: "system", 
            content: `You are Yobest, expert Roblox Lua developer.
Always respond in clear English.
**Always** put the full script in a code block:
\`\`\`lua
-- Full code here
\`\`\`
Do not cut the code.` 
        },
        { role: "user", content: userInput }
    ];

    if (message.attachments.size > 0) {
        const images = Array.from(message.attachments.values())
            .filter(a => a.contentType?.startsWith("image/"))
            .map(a => ({ type: "image_url", image_url: { url: a.url } }));

        if (images.length) {
            messages.push({ role: "user", content: [{ type: "text", text: "Analyze this image:" }, ...images] });
        }
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 1400,
            temperature: 0.7
        });
        return completion.choices[0].message.content;
    } catch (err) {
        console.error(err);
        return "I'm here to help with Roblox scripts! What do you need?";
    }
}

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
        await message.channel.send("❌ Scan error.");
    }
}

client.login(process.env.DISCORD_TOKEN);