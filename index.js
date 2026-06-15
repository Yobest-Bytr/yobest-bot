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
                .setTitle("🤖 Yobest Bot - لوحة التحكم")
                .setColor(0x00FFAA)
                .addFields(
                    { name: "🎮 أوامر الإعلان", value: "`!announce title|desc|yt|dl|rb`" },
                    { name: "🧠 الذكاء الاصطناعي", value: "`!enableai` | `!disableai`" },
                    { name: "🔨 إدارية", value: "`!ban @user` | `!kick @user` | `!purge 50`" },
                    { name: "📜 أوامر أخرى", value: "`!warn @user` | `!say [text]`" }
                );
            return message.reply({ embeds: [embed] });
        }

        if (lower.startsWith("!announce ")) {
            // ... (نفس الكود السابق مع تحسينات)
            const args = content.slice(10).split("|").map(s => s.trim());
            if (args.length < 5) return message.reply("❌ الاستخدام: `!announce العنوان|الوصف|ايدي اليوتيوب|رابط التحميل|رابط روبلوكس`");
            
            const [title, desc, ytId, dlUrl, rbUrl] = args;
            // Embed + Buttons (كود الإعلان السابق)
            const embed = new EmbedBuilder()
                .setTitle(`🚨 ${title}`)
                .setDescription(desc)
                .setColor(0x00FFAA)
                .setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`)
                .addFields(
                    { name: "⬇️ Download", value: `[اضغط هنا](${dlUrl})` },
                    { name: "🎮 Play", value: `[Play in Roblox](${rbUrl})` }
                );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Download Now").setStyle(ButtonStyle.Link).setURL(dlUrl).setEmoji("📥"),
                new ButtonBuilder().setLabel("Play Roblox").setStyle(ButtonStyle.Link).setURL(rbUrl).setEmoji("🎮")
            );

            await message.channel.send({ 
                content: "@everyone @here <:BYT1:1205615882211033138> **BYTR NEW UPDATE** <:BYT1:1205615882211033138>",
                embeds: [embed], 
                components: [row] 
            });
            return message.reply("✅ تم نشر الإعلان بنجاح!");
        }

        // Ban / Kick / Purge
        if (lower.startsWith("!ban ")) {
            const user = message.mentions.users.first();
            if (!user) return message.reply("❌ Mention user to ban.");
            message.guild.members.ban(user, { reason: "Banned by Yobest Bot" });
            return message.reply(`✅ تم تبنيد ${user.tag}`);
        }

        if (lower.startsWith("!kick ")) {
            const user = message.mentions.users.first();
            if (!user) return message.reply("❌ Mention user to kick.");
            message.guild.members.kick(user);
            return message.reply(`✅ تم طرد ${user.tag}`);
        }

        if (lower.startsWith("!purge ")) {
            const amount = parseInt(lower.split(" ")[1]) || 20;
            await message.channel.bulkDelete(amount, true);
            return message.reply(`🧹 تم حذف ${amount} رسالة.`).then(m => setTimeout(() => m.delete(), 3000));
        }
    }

    // ====================== AI MODE ======================
    if (aiEnabledChannels.has(message.channel.id)) {
        // Moderation
        const isBad = await moderateMessage(message);
        if (isBad) {
            await message.delete().catch(() => {});
            return message.channel.send("⚠️ رسالة مخالفة تم حذفها بواسطة Yobest AI");
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
            messages: [{ role: "user", content: `هل هذه الرسالة تحتوي على سب، إزعاج، احتيال، إباحية أو إعلان غير مرغوب؟ رد بـ YES أو NO فقط.\nالرسالة: ${message.content}` }],
            max_tokens: 10
        });
        return res.choices[0].message.content.toUpperCase().includes("YES");
    } catch { return false; }
}

async function getAIResponse(message) {
    const userMsg = message.content.replace(`<@${client.user.id}>`, "").trim() || "مرحبا";

    const systemPrompt = `أنت Yobest - مساعد روبلوكس ذكي وودود. 
    متخصص في كتابة سكربتات Lua نظيفة وقوية.
    استخدم \`\`\`lua\nكود هنا\n\`\`\` لعرض السكربتات.
    كن مفيداً، متحمساً، وموجزاً.`;

    const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMsg }
    ];

    // دعم الصور
    if (message.attachments.size > 0) {
        messages.push({
            role: "user",
            content: [
                { type: "text", text: "تحليل هذه الصورة ومساعدتي في روبلوكس:" },
                ...Array.from(message.attachments.values()).map(att => ({
                    type: "image_url", image_url: { url: att.url }
                }))
            ]
        });
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "google/gemini-3.5-flash",
            messages,
            max_tokens: 600,
            temperature: 0.7
        });

        let reply = completion.choices[0].message.content;
        return reply;
    } catch (err) {
        console.error(err);
        return "🛠️ مشغول حالياً... جرب مرة أخرى!";
    }
}

client.login(process.env.DISCORD_TOKEN);