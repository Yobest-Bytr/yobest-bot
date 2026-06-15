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

    // ====================== ADMIN COMMANDS ======================
    if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        if (lower === "!help") {
            const embed = new EmbedBuilder()
                .setTitle("🤖 Yobest Bot Commands")
                .setColor(0x00FFAA)
                .addFields(
                    { name: "📢 Announcement", value: "`!announce title|description|youtube_id|download_url|roblox_url`" },
                    { name: "🧠 AI System", value: "`!enableai` | `!disableai`" },
                    { name: "🔨 Moderation", value: "`!ban @user` | `!kick @user` | `!purge 50` | `!warn @user`" },
                    { name: "📢 Utility", value: "`!say [message]`" }
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
                new ButtonBuilder().setLabel("Download Now").setStyle(ButtonStyle.Link).setURL(downloadUrl).setEmoji("📥"),
                new ButtonBuilder().setLabel("Play Roblox").setStyle(ButtonStyle.Link).setURL(robloxUrl).setEmoji("🎮")
            );

            await message.channel.send({
                content: "@everyone @here 🚨 **New Update by BYTR** 🚨",
                embeds: [embed],
                components: [row]
            });
            return message.reply("✅ Announcement posted successfully!");
        }

        // Moderation Commands
        if (lower.startsWith("!ban ")) {
            const user = message.mentions.users.first();
            if (!user) return message.reply("❌ Please mention a user to ban.");
            await message.guild.members.ban(user, { reason: `Banned by ${message.author.tag}` });
            return message.reply(`✅ Banned ${user.tag}`);
        }

        if (lower.startsWith("!kick ")) {
            const user = message.mentions.users.first();
            if (!user) return message.reply("❌ Please mention a user to kick.");
            await message.guild.members.kick(user);
            return message.reply(`✅ Kicked ${user.tag}`);
        }

        if (lower.startsWith("!purge ")) {
            const amount = parseInt(lower.split(" ")[1]) || 20;
            await message.channel.bulkDelete(Math.min(amount, 100), true);
            return message.reply(`🧹 Purged ${amount} messages.`).then(m => setTimeout(() => m.delete(), 4000));
        }

        if (lower.startsWith("!say ")) {
            const text = content.slice(5);
            return message.channel.send(text);
        }
    }

    // ====================== AI CHAT ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        const shouldModerate = await moderateMessage(message);
        if (shouldModerate) {
            await message.delete().catch(() => {});
            return message.channel.send("⚠️ Inappropriate message removed by Yobest.");
        }

        if (message.mentions.has(client.user) || lower.includes("yobest") || Math.random() < 0.35) {
            const response = await getAIResponse(message);
            if (response) await message.reply(response);
        }
    }
});

async function moderateMessage(message) {
    try {
        const res = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages: [{ role: "user", content: `Is this message toxic, spam, scam, NSFW or rule-breaking? Answer only YES or NO.\nMessage: ${message.content.substring(0, 400)}` }],
            max_tokens: 10
        });
        return res.choices[0].message.content.toUpperCase().includes("YES");
    } catch { return false; }
}

async function getAIResponse(message) {
    const userInput = message.content.replace(`<@${client.user.id}>`, "").trim();

    const messages = [
        { 
            role: "system", 
            content: "You are Yobest, a highly skilled and friendly Roblox developer assistant. You excel at writing clean, optimized, and well-commented Lua scripts for Roblox Studio. Always respond in English. Use proper ```lua code blocks." 
        },
        { role: "user", content: userInput }
    ];

    // Image support
    if (message.attachments.size > 0) {
        messages.push({
            role: "user",
            content: [
                { type: "text", text: "Please analyze this image and help with Roblox development:" },
                ...Array.from(message.attachments.values()).filter(att => att.contentType?.startsWith("image/")).map(att => ({
                    type: "image_url", image_url: { url: att.url }
                }))
            ]
        });
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 700,
            temperature: 0.75
        });

        return completion.choices[0].message.content;
    } catch (err) {
        console.error(err);
        return "I'm a bit busy right now. Please try again in a moment!";
    }
}

client.login(process.env.DISCORD_TOKEN);