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
const violationCount = new Map(); // Track bad behavior per user

client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // OWNER COMMANDS
    if (isOwner && lower === "!scanandclean") {
        return await scanAndCleanChannel(message);
    }

    // ADMIN COMMANDS
    if (isAdmin) {
        if (lower === "!help") {
            const embed = new EmbedBuilder()
                .setTitle("🤖 Yobest Bot Commands")
                .setColor(0x00FFAA)
                .addFields(
                    { name: "📢 Announcement", value: "`!announce title|desc|yt_id|download|roblox`" },
                    { name: "🧠 AI", value: "`!enableai` | `!disableai`" },
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50`" },
                    { name: "👑 Owner", value: "`!scanandclean`" }
                );
            return message.reply({ embeds: [embed] });
        }

        if (lower.startsWith("!announce ")) {
            const args = content.slice(10).split("|").map(s => s.trim());
            if (args.length < 5) return message.reply("❌ Usage: `!announce title|description|youtube_id|download_url|roblox_url`");
            // ... (announce code same as before)
            const [title, description, ytId, downloadUrl, robloxUrl] = args;
            const embed = new EmbedBuilder()
                .setTitle(`🚨 ${title}`)
                .setDescription(description)
                .setColor(0x00FFAA)
                .setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`)
                .addFields(
                    { name: "⬇️ Download", value: `[Click Here](${downloadUrl})` },
                    { name: "🎮 Play", value: `[Play Now](${robloxUrl})` }
                );
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(downloadUrl),
                new ButtonBuilder().setLabel("Play Roblox").setStyle(ButtonStyle.Link).setURL(robloxUrl)
            );
            await message.channel.send({ content: "@everyone @here 🚨 **New Update by BYTR** 🚨", embeds: [embed], components: [row] });
            return message.reply("✅ Announcement posted!");
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

    // ====================== AI SYSTEM ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        const isBad = await moderateMessage(message);
        if (isBad) {
            await message.delete().catch(() => {});
            await applyTimeout(message);
            return;
        }

        const isMentioned = message.mentions.has(client.user);
        const hasTrigger = lower.includes("yobest") || lower.includes("bot") || lower.includes("help") || 
                          lower.includes("script") || lower.includes("code") || lower.startsWith("hello");

        if (isMentioned || hasTrigger || Math.random() < 0.5) {
            // Show thinking message
            const thinkingMsg = await message.reply("🤔 **Yobest is thinking...**");

            // Multiple reactions
            await message.react("❤️").catch(() => {});
            await message.react("👍").catch(() => {});
            await message.react("🎮").catch(() => {});

            const response = await getAIResponse(message);
            
            // Delete thinking message and send real reply
            await thinkingMsg.delete().catch(() => {});
            
            if (response) {
                const reply = await message.reply(response);
                
                // Create thread for script requests
                if (lower.includes("script") || lower.includes("code")) {
                    try {
                        await reply.startThread({
                            name: `Roblox Script Help - ${message.author.username}`,
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
            messages: [{ role: "user", content: `Is this message toxic, spam, scam, advertising, NSFW or against rules? Answer ONLY with YES or NO.\nMessage: ${message.content.substring(0, 600)}` }],
            max_tokens: 10
        });
        return res.choices[0].message.content.toUpperCase().trim().includes("YES");
    } catch { return false; }
}

async function applyTimeout(message) {
    const userId = message.author.id;
    const current = (violationCount.get(userId) || 0) + 1;
    violationCount.set(userId, current);

    try {
        const member = message.member;
        if (current >= 2) {
            await member.timeout(5 * 60 * 1000, "Repeated violations"); // 5 minutes timeout
            await message.channel.send(`⛔ ${message.author} has been timed out for 5 minutes due to violations.`);
        } else {
            await message.channel.send(`⚠️ ${message.author} Watch your language or you will be timed out.`);
        }
    } catch (e) {}
}

async function getAIResponse(message) {
    const userInput = message.content.replace(`<@${client.user.id}>`, "").trim() || "Hello";

    const messages = [
        { 
            role: "system", 
            content: `You are Yobest, a highly skilled Roblox Lua scripting expert.
Always answer in clear English.
**Always** use proper code blocks:
\`\`\`lua
-- code here
\`\`\`
Be helpful, detailed, and use best practices.` 
        },
        { role: "user", content: userInput }
    ];

    // Image support
    if (message.attachments.size > 0) {
        const images = Array.from(message.attachments.values())
            .filter(a => a.contentType?.startsWith("image/"))
            .map(a => ({ type: "image_url", image_url: { url: a.url } }));

        if (images.length) {
            messages.push({ role: "user", content: [{ type: "text", text: "Analyze this image for Roblox scripting:" }, ...images] });
        }
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 950,
            temperature: 0.7
        });
        return completion.choices[0].message.content;
    } catch (err) {
        console.error(err);
        return "I'm ready! How can I help you with Roblox today?";
    }
}

async function scanAndCleanChannel(message) {
    await message.reply("🔍 Scanning recent messages...");
    try {
        const msgs = await message.channel.messages.fetch({ limit: 100 });
        let deleted = 0;
        for (const msg of msgs.values()) {
            if (msg.author.bot) continue;
            if (await moderateMessage(msg)) {
                await msg.delete().catch(() => {});
                deleted++;
            }
        }
        await message.channel.send(`✅ Scan complete. Deleted **${deleted}** bad messages.`);
    } catch (e) {
        await message.channel.send("❌ Scan failed.");
    }
}

client.login(process.env.DISCORD_TOKEN);