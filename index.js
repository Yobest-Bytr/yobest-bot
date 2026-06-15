const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const OpenAI = require("openai");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ]
});

const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
});

const aiEnabledChannels = new Set();
const violationCount = new Map();

client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online!`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim().toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // === COMMANDS ===
    if (isOwner && content === "!scanandclean") return scanAndCleanChannel(message);

    if (isAdmin) {
        if (content === "!help") {
            const embed = new EmbedBuilder()
                .setTitle("🤖 Yobest Bot Commands")
                .setColor(0x00FFAA)
                .addFields(
                    { name: "AI Chat", value: "`!enableai` | `!disableai`" },
                    { name: "Owner", value: "`!scanandclean`" }
                );
            return message.reply({ embeds: [embed] });
        }

        if (content === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ **AI Chat Enabled** (Moderation always active)");
        }
        if (content === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("❌ AI Chat Disabled");
        }
    }

    // === GLOBAL MODERATION (Always Active) ===
    if (await moderateMessage(message)) {
        await message.delete().catch(() => {});
        await applyTimeout(message);
        return;
    }

    // === AI CHAT (Only when enabled) ===
    if (aiEnabledChannels.has(message.channel.id)) {
        const shouldReply = message.mentions.has(client.user) || 
                           content.includes("yobest") || content.includes("bot") ||
                           content.includes("script") || content.includes("code") ||
                           content.includes("hello") || content.includes("hi") ||
                           Math.random() < 0.65;

        if (shouldReply) {
            const thinking = await message.reply("🤔 **Yobest is thinking...**");

            const response = await getAIResponse(message);
            await thinking.delete().catch(() => {});

            if (response) {
                await message.reply(response);
            }
        }
    }
});

async function moderateMessage(message) {
    const badWords = ["fuck", "sex", "shit", "bitch", "asshole", "cunt", "fucker"];
    if (badWords.some(word => message.content.toLowerCase().includes(word))) return true;

    try {
        const res = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages: [{ role: "user", content: `Bad language? YES or NO only.\nMessage: ${message.content}` }],
            max_tokens: 5
        });
        return res.choices[0].message.content.toUpperCase().includes("YES");
    } catch { return false; }
}

async function applyTimeout(message) {
    const userId = message.author.id;
    const count = (violationCount.get(userId) || 0) + 1;
    violationCount.set(userId, count);

    if (count >= 2) {
        await message.member.timeout(10 * 60 * 1000, "Bad language").catch(() => {});
        message.channel.send(`⛔ ${message.author} timed out for 10 minutes.`).catch(() => {});
    } else {
        message.channel.send(`⚠️ ${message.author} No bad words!`).catch(() => {});
    }
}

async function getAIResponse(message) {
    const userInput = message.content.replace(/<@!?[0-9]+>/g, "").trim() || "hello";

    const systemPrompt = `You are Yobest, a professional Roblox Lua scripter.
Always reply in English.
If the user asks for a script, ALWAYS give the FULL code in this format:

\`\`\`lua
-- Full script here
\`\`\`

Never say "here is part of the code". Give complete working scripts.`;

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userInput }
            ],
            max_tokens: 1500,
            temperature: 0.7
        });

        return completion.choices[0].message.content;
    } catch (e) {
        console.error(e);
        return "Sorry, I'm having trouble right now. Try again.";
    }
}

async function scanAndCleanChannel(message) {
    await message.reply("🔍 Scanning...");
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
        await message.channel.send("❌ Error scanning.");
    }
}

client.login(process.env.DISCORD_TOKEN);