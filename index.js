const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { Pool } = require("pg");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const pool = new Pool({
    connectionString: process.env.NEON_DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot is Online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    if (message.content === "!shark") {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply("❌ You need Administrator permission.");
        }

        try {
            const result = await pool.query("SELECT * FROM games WHERE status = 'active' ORDER BY id DESC LIMIT 1");
            const game = result.rows[0];

            if (!game) return message.reply("❌ No active game found.");

            const embed = new EmbedBuilder()
                .setTitle(`🚨 ${game.title}`)
                .setDescription(game.description || "🔥 New Update!")
                .setColor(0x00FFAA)
                .setImage(`https://img.youtube.com/vi/${game.youtube_video_id || "dQw4w9WgXcQ"}/maxresdefault.jpg`)
                .addFields(
                    { name: "⬇️ Download", value: `[Click Here](${game.download_url})` },
                    { name: "🎮 Play Roblox", value: `[Play Now](${game.roblox_url})` }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel("Download Now").setStyle(ButtonStyle.Link).setURL(game.download_url).setEmoji("📥"),
                new ButtonBuilder().setLabel("Play in Roblox").setStyle(ButtonStyle.Link).setURL(game.roblox_url).setEmoji("🎮")
            );

            await message.channel.send({ content: "@everyone @here", embeds: [embed], components: [row] });

        } catch (err) {
            console.error(err);
            message.reply("❌ Database connection error.");
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
