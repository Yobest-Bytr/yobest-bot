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
const violationCount = new Map();

client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // ====================== COMMANDS ======================
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
                    { name: "🧠 AI System", value: "`!enableai` | `!disableai`" },
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50`" },
                    { name: "👑 Owner", value: "`!scanandclean`" }
                );
            return message.reply({ embeds: [embed] });
        }

        if (lower.startsWith("!announce ")) {
            const args = content.slice(10).split("|").map(s => s.trim());
            if (args.length < 5) return message.reply("❌ Usage: `!announce title|description|youtube_id|download_url|roblox_url`");
            
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
            return message.reply("✅ Announcement posted!");
        }

        if (lower === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ **AI System Enabled** in this channel. Moderation is now active.");
        }
        if (lower === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("❌ **AI System Disabled** in this channel.");
        }
    }

    // ====================== AI + MODERATION (Only in Enabled Channels) ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        // Moderation
        const isBad = await moderateMessage(message);
        if (isBad) {
            await message.delete().catch(() => {});
            await applyTimeout(message);
            return;
        }

        // AI Response Trigger
        const isMentioned = message.mentions.has(client.user);
        const hasTrigger = lower.includes("yobest") || lower.includes("bot") || 
                          lower.includes("script") || lower.includes("code") || 
                          lower.includes("help") || lower.startsWith("hello");

        if (isMentioned || hasTrigger || Math.random() < 0.4) {
            const thinkingMsg = await message.reply("🤔 **Yobest is thinking...**");

            await message.react("❤️").catch(() => {});
            await message.react("👍").catch(() => {});
            await message.react("🎮").catch(() => {});

            const response = await getAIResponse(message);
            
            await thinkingMsg.delete().catch(() => {});

            if (response) {
                const reply = await message.reply(response);
                
                if (lower.includes("script") || lower.includes("code")) {
                    try {
                        await reply.startThread({
                            name: `Roblox Help - ${message.author.username}`,
                            autoArchiveDuration: 1440,
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
            messages: [{ role: "user", content: `Is this message toxic, spam, scam, NSFW, or rule-breaking? Answer ONLY YES or NO.\nMessage: ${message.content.substring(0, 600)}` }],
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
            await message.member.timeout(10 * 60 * 1000, "Repeated violations");
            await message.channel.send(`⛔ ${message.author} has been timed out for 10 minutes.`);
        } else {
            await message.channel.send(`⚠️ ${message.author} Please follow the rules.`);
        }
    } catch (e) {}
}

async function getAIResponse(message) {
    const userInput = message.content.replace(`<@${client.user.id}>`, "").trim() || "Hello";

    const messages = [
        { 
            role: "system", 
            content: `You are Yobest, an expert Roblox Lua scripter.
Always respond in clear English.
**Always** provide the full script inside a proper code block:
\`\`\`lua
-- Full script here
\`\`\`
Never cut off the code. Be detailed and professional.` 
        },
        { role: "user", content: userInput }
    ];

    if (message.attachments.size > 0) {
        const images = Array.from(message.attachments.values())
            .filter(a => a.contentType?.startsWith("image/"))
            .map(a => ({ type: "image_url", image_url: { url: a.url } }));

        if (images.length) {
            messages.push({ 
                role: "user", 
                content: [{ type: "text", text: "Analyze this image and provide the Roblox script:" }, ...images] 
            });
        }
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 1200,
            temperature: 0.65
        });
        return completion.choices[0].message.content;
    } catch (err) {
        console.error(err);
        return "I'm ready to help! Please tell me what script you need.";
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