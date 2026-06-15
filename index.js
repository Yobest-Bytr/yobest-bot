const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const OpenAI = require("openai");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
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

    const content = message.content.toLowerCase().trim();

    if (content === "!help") {
        return message.reply("**Yobest Bot Commands:**\n`!announce title|desc|yt_id|dl|rb`\n`!enableai` | `!disableai`");
    }

    if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
        if (content.startsWith("!announce ")) {
            const args = message.content.slice(10).split("|").map(s => s.trim());
            if (args.length < 5) return message.reply("❌ Usage: `!announce title|description|youtube_id|download_url|roblox_url`");

            const [title, description, ytId, dlUrl, rbUrl] = args;

            const embed = new EmbedBuilder()
                .setTitle(`🚨 ${title}`)
                .setDescription(description)
                .setColor(0x00FFAA)
                .setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`)
                .addFields(
                    { name: "⬇️ Download", value: `[Click Here](${dlUrl})` },
                    { name: "🎮 Play Roblox", value: `[Play Now](${rbUrl})` }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Download Now").setStyle(ButtonStyle.Link).setURL(dlUrl).setEmoji("📥"),
                new ButtonBuilder().setLabel("Play in Roblox").setStyle(ButtonStyle.Link).setURL(rbUrl).setEmoji("🎮")
            );

            await message.channel.send({ 
                content: "@everyone @here 🚨 **Roblox Studio by BYTR** 🚨\n<:BYT1:1205615882211033138><:BYT1:1205615882211033138><:BYT1:1205615882211033138>", 
                embeds: [embed], 
                components: [row] 
            });

            return message.reply("✅ Announcement posted!");
        }

        if (content === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ AI (Yobest) enabled in this channel.");
        }
        if (content === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("✅ AI disabled.");
        }
    }

    // AI Mode
    if (aiEnabledChannels.has(message.channel.id)) {
        if (Math.random() < 0.4 || message.mentions.has(client.user)) {
            try {
                const response = await getAIResponse(message);
                if (response) await message.reply(response);
            } catch (e) {}
        }
    }
});

async function getAIResponse(message) {
    const messages = [{
        role: "system",
        content: "You are Yobest, a helpful and enthusiastic Roblox developer assistant. Focus on Roblox Studio, scripting, uncopylocked games. Be friendly and concise."
    }];

    let userContent = message.content.replace(`<@${client.user.id}>`, "").trim();
    messages.push({ role: "user", content: userContent });

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 300,
        });
        return completion.choices[0].message.content;
    } catch (err) {
        return "I'm here! Ask me anything about Roblox development.";
    }
}

client.login(process.env.DISCORD_TOKEN);