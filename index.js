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

client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // ====================== OWNER COMMANDS ======================
    if (isOwner) {
        if (lower === "!scanandclean") {
            return await scanAndCleanChannel(message);
        }
    }

    // ====================== ADMIN COMMANDS ======================
    if (isAdmin) {
        if (lower === "!help") {
            const embed = new EmbedBuilder()
                .setTitle("🤖 Yobest Bot Commands")
                .setColor(0x00FFAA)
                .addFields(
                    { name: "📢 Announcement", value: "`!announce title|desc|yt_id|download|roblox`" },
                    { name: "🧠 AI System", value: "`!enableai` | `!disableai`" },
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50` | `!warn @user`" },
                    { name: "📢 Utility", value: "`!say [text]`" },
                    { name: "👑 Owner Only", value: "`!scanandclean`" }
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
                    { name: "🎮 Play in Roblox", value: `[Play Now](${robloxUrl})` }
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

        if (lower.startsWith("!ban ")) { /* same as before */ }
        if (lower.startsWith("!kick ")) { /* same as before */ }
        if (lower.startsWith("!purge ")) { /* same as before */ }
        if (lower.startsWith("!say ")) {
            const text = content.slice(5);
            return message.channel.send(text);
        }

        if (lower === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ AI System **Enabled** in this channel.");
        }
        if (lower === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("❌ AI System **Disabled** in this channel.");
        }
    }

    // ====================== AI CHAT ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        const shouldDelete = await moderateMessage(message);
        if (shouldDelete) {
            await message.delete().catch(() => {});
            return message.channel.send("⚠️ Inappropriate message removed.");
        }

        // Improved trigger conditions
        const isMentioned = message.mentions.has(client.user);
        const containsName = lower.includes("yobest") || lower.includes("bot");
        
        if (isMentioned || containsName || lower.startsWith("hello") || Math.random() < 0.45) {
            const response = await getAIResponse(message);
            if (response) {
                await message.reply(response);
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
                content: `Is this message toxic, spam, scam, advertising, NSFW or rule-breaking? Reply ONLY with YES or NO.\n\nMessage: ${message.content.substring(0, 500)}` 
            }],
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
            content: "You are Yobest, a highly skilled, friendly, and professional Roblox Lua scripting expert. Always respond in clear English. Use ```lua code blocks for scripts. Be helpful and detailed." 
        },
        { role: "user", content: userInput }
    ];

    // Support images
    if (message.attachments.size > 0) {
        const imageContents = Array.from(message.attachments.values())
            .filter(att => att.contentType?.startsWith("image/"))
            .map(att => ({ type: "image_url", image_url: { url: att.url } }));

        if (imageContents.length > 0) {
            messages.push({
                role: "user",
                content: [{ type: "text", text: "Analyze this image and help with Roblox development:" }, ...imageContents]
            });
        }
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 800,
            temperature: 0.7
        });
        return completion.choices[0].message.content;
    } catch (err) {
        console.error("AI Error:", err);
        return "I'm here! How can I help you with Roblox today?";
    }
}

async function scanAndCleanChannel(message) {
    await message.reply("🔍 Scanning recent messages for violations...");

    try {
        const messages = await message.channel.messages.fetch({ limit: 100 });
        let deletedCount = 0;

        for (const msg of messages.values()) {
            if (msg.author.bot) continue;
            const isBad = await moderateMessage(msg);
            if (isBad) {
                await msg.delete().catch(() => {});
                deletedCount++;
            }
        }

        await message.channel.send(`✅ Scan complete! Deleted **${deletedCount}** violating messages.`);
    } catch (err) {
        await message.channel.send("❌ Error during scan.");
        console.error(err);
    }
}

client.login(process.env.DISCORD_TOKEN);