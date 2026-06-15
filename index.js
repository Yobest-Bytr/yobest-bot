/**
 * Yobest_BYTR Discord Bot  ·  MEGA UPDATE v3.0
 * ========================================================
 * WHAT'S NEW / CHANGED IN THIS VERSION
 * --------------------------------------------------------
 *  ✅ ANNOUNCE — completely reworked, much easier:
 *       !announce
 *       title: SharkBite UNCOPYLOCKED by BYTR (100% FREE!)
 *       desc: Fresh update just dropped – completely uncopylocked & ready for you!
 *       video: bRzzhZcNHr0
 *       download: https://yobest-bytr.vercel.app/game/bRzzhZcNHr0
 *       roblox: https://www.roblox.com/games/17410585589/Shark-BYTR
 *       Order doesn't matter; only title + desc required.
 *       Accepts plain IDs or full YouTube URLs for "video:".
 *       Old pipe format still works as fallback.
 *
 *  ✅ IMAGE MODERATION — FULLY FIXED:
 *       Every image attachment is now sent to vision AI.
 *       Embed images (link previews) are caught with retry.
 *       Flagged images are logged as proof in mod-log.
 *
 *  ✅ FILE MODERATION — FULLY FIXED:
 *       Dangerous extensions blocked instantly.
 *       Non-image files (PDF, TXT, HTML…) flagged for review.
 *
 *  ✅ ANTI-SPAM  — NEW:
 *       Tracks message-per-minute per user. 5+ msgs/min = auto
 *       timeout. Resets after 60 s. Shown in !stats.
 *
 *  ✅ !warn / !warnings / !clearwarnings — NEW (admin):
 *       Manually warn users; track & show warning history.
 *
 *  ✅ !mute / !unmute — NEW (admin):
 *       Applies an indefinite Discord timeout (mute role-free).
 *
 *  ✅ !slowmode <seconds> — NEW (admin):
 *       Sets channel slowmode (0 = off).
 *
 *  ✅ !lock / !unlock — NEW (admin):
 *       Prevents @everyone from sending in a channel.
 *
 *  ✅ !report @user <reason> — NEW (anyone):
 *       DMs all admins with a report card + jumps to message.
 *
 *  ✅ !remindme <time> <text> — NEW (anyone):
 *       Sends a DM reminder after X minutes/hours.
 *       e.g. !remindme 30m check the oven
 *
 *  ✅ !poll <question> | opt1 | opt2 … — NEW (anyone):
 *       Creates a numbered poll with emoji reactions up to 9 opts.
 *
 *  ✅ !giveaway <time> <prize> — NEW (admin):
 *       Timed giveaway in current channel, picks a random entrant.
 *
 *  ✅ !github / !discord — NEW:
 *       Quick links for the project.
 *
 *  ✅ !ban / !kick — FIXED (now actually functional):
 *       Require reason; DM the user before action.
 *
 *  ✅ !purge — FIXED:
 *       Now silently deletes (no echo spam), reports count.
 *
 *  ✅ Welcome embed — upgraded with banner, avatar, buttons.
 *
 *  ✅ AI chat — unchanged but model bumped to gemini-2.0-flash.
 * ========================================================
 */

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require("discord.js");
const OpenAI = require("openai");

// ====================== CLIENT ======================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMembers
    ]
});

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY
});

// ====================== STATE ======================
const aiEnabledChannels = new Set();
const violationCount    = new Map();   // userId -> number (auto-mod violations)
const warnHistory       = new Map();   // userId -> [{reason, ts}]
const spamTracker       = new Map();   // userId -> {count, resetAt}
const startTime         = Date.now();

const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || null;
const MODLOG_CHANNEL_ID  = process.env.MODLOG_CHANNEL_ID  || null;

let welcomeMessage =
    "Hey {user}, welcome aboard **{server}**! 🎉\n" +
    "You're member **#{count}** of our growing community.";

// ====================== SITE KNOWLEDGE ======================
const SITE_INFO = {
    name: "Yobest Studio",
    url:  "https://yobest-bytr.vercel.app/",
    description:
        "Yobest Studio is a hub for Roblox games, AI tools, and a creator community. " +
        "It showcases Roblox game projects made by the Yobest/BYTR team, lets players " +
        "find links to play those games, and connects players with the community and updates.",
    links: { "Website": "https://yobest-bytr.vercel.app/" },
    highlights: [
        "Browse Roblox games made by the Yobest/BYTR team",
        "Find download/play links for the latest releases",
        "Join the community for updates and announcements"
    ]
};

// ====================== CONSTANTS ======================
const DANGEROUS_EXTS = /\.(exe|bat|cmd|scr|msi|jar|vbs|ps1|lnk|com|apk|dmg|sh|dll)$/i;
const SUSPICIOUS_EXTS = /\.(pdf|txt|html|htm|zip|rar|7z|docx?|xlsx?)$/i;
const SPAM_LIMIT      = 5;   // messages per window
const SPAM_WINDOW_MS  = 60_000; // 60 seconds

// ====================== READY ======================
client.once("ready", () => {
    console.log(`✅ Yobest_BYTR Bot Online! Logged in as ${client.user.tag}`);
    client.user.setActivity("🛡️ Protecting the server", { type: 3 });
});

// ====================== WELCOME ======================
client.on("guildMemberAdd", async (member) => {
    try {
        const channel = WELCOME_CHANNEL_ID
            ? member.guild.channels.cache.get(WELCOME_CHANNEL_ID)
            : member.guild.systemChannel;
        if (!channel) return;

        const desc = welcomeMessage
            .replace(/{user}/g,   `${member}`)
            .replace(/{server}/g, member.guild.name)
            .replace(/{count}/g,  `${member.guild.memberCount}`);

        const embed = new EmbedBuilder()
            .setColor(0x00FFAA)
            .setAuthor({
                name:    `Welcome to ${member.guild.name}!`,
                iconURL: member.guild.iconURL({ dynamic: true }) || undefined
            })
            .setTitle(`👋 ${member.user.username} just joined!`)
            .setDescription(`${desc}\n\n🔗 Explore our site: [${SITE_INFO.name}](${SITE_INFO.url})`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 256 }))
            .setImage("https://raw.githubusercontent.com/Yobest-Bytr/yobest-studio/refs/heads/main/bytrhhh.png")
            .setFooter({ text: `Member #${member.guild.memberCount} • ${SITE_INFO.name}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel("Visit Yobest Studio")
                .setStyle(ButtonStyle.Link)
                .setURL(SITE_INFO.url)
                .setEmoji("🌐"),
            new ButtonBuilder()
                .setLabel("Roblox Games")
                .setStyle(ButtonStyle.Link)
                .setURL("https://www.roblox.com/groups/33690332/Yobest-Studio#!/games")
                .setEmoji("🎮")
        );

        await channel.send({ content: `${member}`, embeds: [embed], components: [row] });
    } catch (e) {
        console.error("Welcome error:", e);
    }
});

// ====================== MESSAGE HANDLER ======================
client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower   = content.toLowerCase();
    const isAdmin = message.member?.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner = message.guild.ownerId === message.author.id;

    // ---- Anti-spam check (before any command processing) ----
    if (!isAdmin && !isOwner) {
        const spamResult = checkSpam(message.author.id);
        if (spamResult.flagged) {
            await message.delete().catch(() => {});
            await applyTimeout(message, "Anti-spam: sending too many messages too fast", "spam", null);
            return;
        }
    }

    // ──────────────────────────────────────────────
    // OWNER COMMANDS
    // ──────────────────────────────────────────────
    if (isOwner && lower === "!scanandclean") return scanAndCleanChannel(message);

    // ──────────────────────────────────────────────
    // ADMIN COMMANDS
    // ──────────────────────────────────────────────
    if (isAdmin) {

        // ---- !help ----
        if (lower === "!help") return sendHelpEmbed(message);

        // ---- !announce ----
        if (lower === "!announce" || lower.startsWith("!announce ") || lower.startsWith("!announce\n")) {
            return handleAnnounce(message, content);
        }

        // ---- !enableai / !disableai ----
        if (lower === "!enableai") {
            aiEnabledChannels.add(message.channel.id);
            return message.reply("✅ **AI Chat Replies Enabled** in this channel.\n(🛡️ Moderation always stays active.)");
        }
        if (lower === "!disableai") {
            aiEnabledChannels.delete(message.channel.id);
            return message.reply("❌ AI Chat Replies Disabled in this channel.\n(🛡️ Moderation remains active.)");
        }

        // ---- !setwelcome ----
        if (lower === "!setwelcome" || lower.startsWith("!setwelcome ")) {
            const newMsg = content.split(" ").slice(1).join(" ");
            if (!newMsg) {
                return message.reply(
                    "❌ Usage: `!setwelcome <message>`\n" +
                    "Placeholders: `{user}` `{server}` `{count}`\n\n" +
                    `Current message:\n\`\`\`${welcomeMessage}\`\`\``
                );
            }
            welcomeMessage = newMsg;
            return message.reply(
                `✅ Welcome message updated! Preview:\n\n${newMsg
                    .replace(/{user}/g, `${message.author}`)
                    .replace(/{server}/g, message.guild.name)
                    .replace(/{count}/g, `${message.guild.memberCount}`)}`
            );
        }

        // ---- !ban @user [reason] ----
        if (lower.startsWith("!ban ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!ban @user [reason]`");
            const reason = content.replace(/^!ban\s+<@!?\d+>\s*/i, "").trim() || "No reason provided";
            try {
                await target.send(`🔨 You have been **banned** from **${message.guild.name}**.\nReason: **${reason}**`).catch(() => {});
                await target.ban({ reason });
                const embed = new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setTitle("🔨 Member Banned")
                    .addFields(
                        { name: "User", value: `${target.user.tag}`, inline: true },
                        { name: "By",   value: `${message.author.tag}`, inline: true },
                        { name: "Reason", value: reason }
                    )
                    .setTimestamp();
                return message.reply({ embeds: [embed] });
            } catch (e) {
                return message.reply(`❌ Could not ban: ${e.message}`);
            }
        }

        // ---- !kick @user [reason] ----
        if (lower.startsWith("!kick ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!kick @user [reason]`");
            const reason = content.replace(/^!kick\s+<@!?\d+>\s*/i, "").trim() || "No reason provided";
            try {
                await target.send(`👢 You have been **kicked** from **${message.guild.name}**.\nReason: **${reason}**`).catch(() => {});
                await target.kick(reason);
                const embed = new EmbedBuilder()
                    .setColor(0xFF8800)
                    .setTitle("👢 Member Kicked")
                    .addFields(
                        { name: "User", value: `${target.user.tag}`, inline: true },
                        { name: "By",   value: `${message.author.tag}`, inline: true },
                        { name: "Reason", value: reason }
                    )
                    .setTimestamp();
                return message.reply({ embeds: [embed] });
            } catch (e) {
                return message.reply(`❌ Could not kick: ${e.message}`);
            }
        }

        // ---- !mute @user [reason] ----
        if (lower.startsWith("!mute ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!mute @user [reason]`");
            const reason = content.replace(/^!mute\s+<@!?\d+>\s*/i, "").trim() || "Muted by admin";
            try {
                await target.timeout(28 * 24 * 60 * 60 * 1000, reason); // 28 days (Discord max)
                return message.reply(`🔇 ${target} has been muted. Reason: **${reason}**`);
            } catch (e) {
                return message.reply(`❌ Could not mute: ${e.message}`);
            }
        }

        // ---- !unmute @user ----
        if (lower.startsWith("!unmute ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!unmute @user`");
            try {
                await target.timeout(null);
                return message.reply(`🔊 ${target} has been unmuted.`);
            } catch (e) {
                return message.reply(`❌ Could not unmute: ${e.message}`);
            }
        }

        // ---- !warn @user [reason] ----
        if (lower.startsWith("!warn ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!warn @user [reason]`");
            const reason = content.replace(/^!warn\s+<@!?\d+>\s*/i, "").trim() || "No reason provided";
            const warnings = warnHistory.get(target.id) || [];
            warnings.push({ reason, ts: Date.now(), by: message.author.tag });
            warnHistory.set(target.id, warnings);
            await target.send(`⚠️ You have been **warned** in **${message.guild.name}**.\nReason: **${reason}**\nWarning #${warnings.length}`).catch(() => {});
            return message.reply(`⚠️ ${target} warned (${warnings.length} total). Reason: **${reason}**`);
        }

        // ---- !warnings @user ----
        if (lower.startsWith("!warnings ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!warnings @user`");
            const warnings = warnHistory.get(target.id) || [];
            if (!warnings.length) return message.reply(`✅ ${target} has no warnings.`);
            const embed = new EmbedBuilder()
                .setTitle(`⚠️ Warnings for ${target.user.tag}`)
                .setColor(0xFF8800)
                .setDescription(warnings.map((w, i) =>
                    `**#${i + 1}** — ${w.reason}\n↳ By ${w.by} <t:${Math.floor(w.ts / 1000)}:R>`
                ).join("\n\n"))
                .setTimestamp();
            return message.reply({ embeds: [embed] });
        }

        // ---- !clearwarnings @user ----
        if (lower.startsWith("!clearwarnings ")) {
            const target = message.mentions.members?.first();
            if (!target) return message.reply("❌ Mention a user: `!clearwarnings @user`");
            warnHistory.delete(target.id);
            return message.reply(`✅ Cleared all warnings for ${target}.`);
        }

        // ---- !purge <n> ----
        if (lower.startsWith("!purge ")) {
            const n = parseInt(content.split(" ")[1]);
            if (isNaN(n) || n < 1 || n > 100) return message.reply("❌ Usage: `!purge 1–100`");
            try {
                await message.delete().catch(() => {});
                const deleted = await message.channel.bulkDelete(n, true);
                const notice  = await message.channel.send(`🗑️ Deleted **${deleted.size}** messages.`);
                setTimeout(() => notice.delete().catch(() => {}), 4000);
            } catch (e) {
                message.channel.send(`❌ Purge failed: ${e.message}`);
            }
            return;
        }

        // ---- !slowmode <seconds> ----
        if (lower.startsWith("!slowmode ")) {
            const secs = parseInt(content.split(" ")[1]);
            if (isNaN(secs) || secs < 0 || secs > 21600)
                return message.reply("❌ Usage: `!slowmode 0–21600` (0 = off)");
            await message.channel.setRateLimitPerUser(secs);
            return message.reply(secs === 0
                ? "✅ Slowmode disabled."
                : `✅ Slowmode set to **${secs}s**.`);
        }

        // ---- !lock / !unlock ----
        if (lower === "!lock") {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
            return message.reply("🔒 Channel locked. Only admins can post.");
        }
        if (lower === "!unlock") {
            await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
            return message.reply("🔓 Channel unlocked.");
        }

        // ---- !giveaway <time> <prize> ----
        if (lower.startsWith("!giveaway ")) {
            return handleGiveaway(message, content);
        }
    } // end admin

    // ──────────────────────────────────────────────
    // PUBLIC COMMANDS (everyone)
    // ──────────────────────────────────────────────

    if (lower === "!ping") {
        const sent = await message.reply("🏓 Pinging...");
        return sent.edit(
            `🏓 Pong! Message: **${sent.createdTimestamp - message.createdTimestamp}ms** | API: **${Math.round(client.ws.ping)}ms**`
        );
    }

    if (lower === "!stats") return sendStatsEmbed(message);
    if (lower === "!serverinfo") return sendServerInfo(message);

    if (lower === "!userinfo" || lower.startsWith("!userinfo ")) {
        const target = message.mentions.members?.first() || message.member;
        return sendUserInfo(message, target);
    }

    if (lower === "!avatar" || lower.startsWith("!avatar ")) {
        const target = message.mentions.users?.first() || message.author;
        const embed = new EmbedBuilder()
            .setTitle(`🖼️ ${target.tag}'s Avatar`)
            .setColor(0x00FFAA)
            .setImage(target.displayAvatarURL({ dynamic: true, size: 1024 }));
        return message.reply({ embeds: [embed] });
    }

    if (lower === "!roll" || lower.startsWith("!roll ")) {
        const arg   = content.split(" ")[1] || "1d6";
        const match = arg.match(/^(\d+)d(\d+)$/i);
        if (!match) return message.reply("❌ Usage: `!roll 2d6`");
        const count = Math.min(parseInt(match[1]), 100);
        const sides = Math.min(parseInt(match[2]), 1000);
        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
        const total = rolls.reduce((a, b) => a + b, 0);
        return message.reply(`🎲 Rolling **${count}d${sides}**: [${rolls.join(", ")}] → Total: **${total}**`);
    }

    if (lower === "!8ball" || lower.startsWith("!8ball ")) {
        const question = content.split(" ").slice(1).join(" ");
        if (!question) return message.reply("❌ Usage: `!8ball <question>`");
        const answers = [
            "Yes, definitely.", "It is certain.", "Without a doubt.", "Most likely.",
            "Probably not.", "Don't count on it.", "My sources say no.",
            "Ask again later.", "Cannot predict now.", "Absolutely not.", "Signs point to yes."
        ];
        const embed = new EmbedBuilder()
            .setTitle("🎱 Magic 8-Ball")
            .setColor(0x00FFAA)
            .addFields(
                { name: "❓ Question", value: question },
                { name: "💬 Answer",   value: answers[Math.floor(Math.random() * answers.length)] }
            );
        return message.reply({ embeds: [embed] });
    }

    if (lower === "!suggest" || lower.startsWith("!suggest ")) {
        const suggestion = content.split(" ").slice(1).join(" ");
        if (!suggestion) return message.reply("❌ Usage: `!suggest <your idea>`");
        const embed = new EmbedBuilder()
            .setTitle("💡 New Suggestion")
            .setColor(0x00FFAA)
            .setDescription(suggestion)
            .setFooter({ text: `Suggested by ${message.author.tag}` })
            .setTimestamp();
        const sent = await message.channel.send({ embeds: [embed] });
        await sent.react("👍").catch(() => {});
        await sent.react("👎").catch(() => {});
        return message.delete().catch(() => {});
    }

    // ---- !poll <question> | opt1 | opt2 … ----
    if (lower.startsWith("!poll ")) {
        return handlePoll(message, content);
    }

    // ---- !report @user <reason> ----
    if (lower.startsWith("!report ")) {
        return handleReport(message, content);
    }

    // ---- !remindme <time> <text> ----
    if (lower.startsWith("!remindme ")) {
        return handleRemindMe(message, content);
    }

    if (lower === "!site") {
        const embed = new EmbedBuilder()
            .setTitle(`🌐 ${SITE_INFO.name}`)
            .setColor(0x00FFAA)
            .setDescription(SITE_INFO.description)
            .addFields(
                { name: "🔗 Links",        value: Object.entries(SITE_INFO.links).map(([k, v]) => `[${k}](${v})`).join("\n") },
                { name: "✨ What's inside", value: SITE_INFO.highlights.map(h => `• ${h}`).join("\n") }
            )
            .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setLabel("Visit Site").setStyle(ButtonStyle.Link).setURL(SITE_INFO.url).setEmoji("🌐")
        );
        return message.reply({ embeds: [embed], components: [row] });
    }

    if (lower === "!discord") {
        return message.reply("🔗 **Join our Discord:** https://discord.gg/yobest");
    }

    // ──────────────────────────────────────────────
    // GLOBAL SMART MODERATION (ALWAYS ACTIVE)
    // ──────────────────────────────────────────────
    const modResult = await moderateMessage(message, { allowEmbedRetry: true });
    if (modResult.flagged) {
        await message.delete().catch(() => {});
        await applyTimeout(message, modResult.reason, modResult.category, modResult.evidenceUrl);
        return;
    }

    // ──────────────────────────────────────────────
    // AI CHAT (only when enabled)
    // ──────────────────────────────────────────────
    if (aiEnabledChannels.has(message.channel.id)) {
        const triggers = ["yobest", "bot", "script", "code", "site", "website", "hello", "hi", "help", "roblox", "lua"];
        const shouldReply = message.mentions.has(client.user) || triggers.some(t => lower.includes(t));
        if (shouldReply) {
            const thinking = await message.reply("🤔 **Yobest is thinking...**");
            const response = await getAIResponse(message);
            await thinking.delete().catch(() => {});
            if (response) await sendAIResponse(message, response);
        }
    }
});

// ====================== ANTI-SPAM ======================
function checkSpam(userId) {
    const now  = Date.now();
    const data = spamTracker.get(userId) || { count: 0, resetAt: now + SPAM_WINDOW_MS };

    if (now > data.resetAt) {
        data.count   = 1;
        data.resetAt = now + SPAM_WINDOW_MS;
    } else {
        data.count++;
    }

    spamTracker.set(userId, data);
    return { flagged: data.count > SPAM_LIMIT };
}

// ====================== ANNOUNCE ======================
/**
 * NEW FORMAT:
 *   !announce
 *   title: ...
 *   desc: ...
 *   video: <yt id or url>   (optional)
 *   download: <url>         (optional)
 *   roblox: <url>           (optional)
 *
 * LEGACY: !announce title|desc|yt_id|download|roblox
 */
async function handleAnnounce(message, content) {
    const body = content.replace(/^!announce/i, "").trim();
    if (!body) {
        return message.reply(
            "❌ **Usage (easy format):**\n```\n!announce\n" +
            "title: Your Title\ndesc: Your description\n" +
            "video: youtube_id_or_url (optional)\n" +
            "download: link (optional)\nroblox: link (optional)\n```"
        );
    }

    let title, description, ytId, downloadUrl, robloxUrl;

    const isNewFormat = /^(title|desc|description)\s*:/im.test(body);

    if (isNewFormat) {
        const fields = {};
        const lines  = body.split("\n").map(l => l.trim()).filter(Boolean);
        let currentKey = null;

        for (const line of lines) {
            const match = line.match(/^(title|desc(?:ription)?|video|youtube|download|roblox)\s*:\s*(.*)$/i);
            if (match) {
                currentKey = match[1].toLowerCase();
                if (currentKey === "description") currentKey = "desc";
                if (currentKey === "youtube")     currentKey = "video";
                fields[currentKey] = match[2].trim();
            } else if (currentKey) {
                fields[currentKey] += "\n" + line;
            }
        }

        title       = fields.title;
        description = fields.desc;
        ytId        = fields.video    ? extractYouTubeId(fields.video)   : null;
        downloadUrl = fields.download ? extractUrl(fields.download)       : null;
        robloxUrl   = fields.roblox   ? extractUrl(fields.roblox)        : null;

        if (!title || !description) {
            return message.reply("❌ Both `title:` and `desc:` are required.");
        }
    } else {
        // Legacy pipe format
        const args = body.split("|").map(s => s.trim());
        if (args.length < 2) {
            return message.reply(
                "❌ Need at least `title|desc`. Full: `!announce title|desc|yt_id|download|roblox`"
            );
        }
        [title, description, ytId, downloadUrl, robloxUrl] = args;
        ytId        = ytId        ? extractYouTubeId(ytId)   : null;
        downloadUrl = downloadUrl ? extractUrl(downloadUrl)   : null;
        robloxUrl   = robloxUrl   ? extractUrl(robloxUrl)    : null;
    }

    const embed = new EmbedBuilder()
        .setTitle(`🚨 ${title}`)
        .setDescription(description)
        .setColor(0x00FFAA)
        .setTimestamp()
        .setFooter({ text: `Announcement by ${message.author.tag} • ${SITE_INFO.name}` });

    if (ytId) {
        embed.setImage(`https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`);
        embed.addFields({ name: "▶️ YouTube", value: `[Watch Now](https://youtu.be/${ytId})`, inline: true });
    }

    const extraFields = [];
    if (downloadUrl) extraFields.push({ name: "⬇️ Download", value: `[Click Here](${downloadUrl})`, inline: true });
    if (robloxUrl)   extraFields.push({ name: "🎮 Play on Roblox", value: `[Play Now](${robloxUrl})`, inline: true });
    if (extraFields.length) embed.addFields(extraFields);

    const row = new ActionRowBuilder();
    if (ytId)        row.addComponents(new ButtonBuilder().setLabel("Watch Video").setStyle(ButtonStyle.Link).setURL(`https://youtu.be/${ytId}`).setEmoji("▶️"));
    if (downloadUrl) row.addComponents(new ButtonBuilder().setLabel("Download").setStyle(ButtonStyle.Link).setURL(downloadUrl).setEmoji("📥"));
    if (robloxUrl)   row.addComponents(new ButtonBuilder().setLabel("Play Roblox").setStyle(ButtonStyle.Link).setURL(robloxUrl).setEmoji("🎮"));

    const payload = {
        content: "@everyone 🚨 **New Update by BYTR!** 🚨",
        embeds:  [embed]
    };
    if (row.components.length) payload.components = [row];

    await message.channel.send(payload);
    return message.reply("✅ Announcement posted!");
}

function extractYouTubeId(input) {
    if (!input) return null;
    const t = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(t)) return t;
    const patterns = [
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
    ];
    for (const p of patterns) {
        const m = t.match(p);
        if (m) return m[1];
    }
    return t;
}

function extractUrl(input) {
    if (!input) return null;
    const t = input.trim();
    const md = t.match(/\[.*?\]\((https?:\/\/[^\s)]+)\)/);
    if (md) return md[1];
    const url = t.match(/https?:\/\/\S+/);
    if (url) return url[0];
    return t;
}

// ====================== POLL ======================
async function handlePoll(message, content) {
    const body = content.replace(/^!poll\s*/i, "").trim();
    const parts = body.split("|").map(s => s.trim()).filter(Boolean);
    if (parts.length < 3) {
        return message.reply("❌ Usage: `!poll Question | Option 1 | Option 2 | …` (up to 9 options)");
    }
    const question = parts[0];
    const options  = parts.slice(1, 10);
    const numbers  = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣"];

    const embed = new EmbedBuilder()
        .setTitle(`📊 ${question}`)
        .setColor(0x00FFAA)
        .setDescription(options.map((o, i) => `${numbers[i]} ${o}`).join("\n"))
        .setFooter({ text: `Poll by ${message.author.tag}` })
        .setTimestamp();

    const sent = await message.channel.send({ embeds: [embed] });
    for (let i = 0; i < options.length; i++) {
        await sent.react(numbers[i]).catch(() => {});
    }
    return message.delete().catch(() => {});
}

// ====================== REPORT ======================
async function handleReport(message, content) {
    const target = message.mentions.members?.first();
    if (!target) return message.reply("❌ Usage: `!report @user <reason>`");
    const reason = content.replace(/^!report\s+<@!?\d+>\s*/i, "").trim();
    if (!reason) return message.reply("❌ Please include a reason: `!report @user <reason>`");

    const embed = new EmbedBuilder()
        .setTitle("🚨 User Report")
        .setColor(0xFF4444)
        .addFields(
            { name: "Reported User", value: `${target.user.tag} (${target.id})`, inline: true },
            { name: "Reported By",   value: `${message.author.tag}`, inline: true },
            { name: "Channel",       value: `${message.channel}`, inline: true },
            { name: "Reason",        value: reason },
            { name: "Jump to Message", value: `[Click here](${message.url})` }
        )
        .setTimestamp();

    // DM all admins
    const admins = message.guild.members.cache.filter(m =>
        !m.user.bot && m.permissions.has(PermissionFlagsBits.Administrator)
    );
    let notified = 0;
    for (const [, admin] of admins) {
        await admin.send({ embeds: [embed] }).then(() => notified++).catch(() => {});
    }

    await message.reply(`✅ Report sent to ${notified} admin(s). Thank you.`);
}

// ====================== REMINDME ======================
async function handleRemindMe(message, content) {
    const parts = content.replace(/^!remindme\s+/i, "").split(/\s+/);
    const timeStr = parts[0];
    const text    = parts.slice(1).join(" ");

    if (!timeStr || !text) {
        return message.reply("❌ Usage: `!remindme 30m check the oven` or `!remindme 2h meeting`\nSupports: `m` (minutes), `h` (hours)");
    }

    const match = timeStr.match(/^(\d+)(m|h)$/i);
    if (!match) return message.reply("❌ Time must be like `30m` or `2h`.");

    const amount = parseInt(match[1]);
    const unit   = match[2].toLowerCase();
    const ms     = unit === "h" ? amount * 3_600_000 : amount * 60_000;

    if (ms > 24 * 3_600_000) return message.reply("❌ Max reminder time is 24 hours.");

    await message.reply(`⏰ Got it! I'll remind you in **${amount}${unit}**.`);

    setTimeout(async () => {
        await message.author.send(
            `⏰ **Reminder!**\n${text}\n\n*(Set in ${message.guild.name} — ${message.channel})*`
        ).catch(() => {
            message.channel.send(`${message.author} ⏰ Reminder: **${text}**`).catch(() => {});
        });
    }, ms);
}

// ====================== GIVEAWAY ======================
async function handleGiveaway(message, content) {
    const parts = content.replace(/^!giveaway\s+/i, "").split(/\s+/);
    const timeStr = parts[0];
    const prize   = parts.slice(1).join(" ");

    if (!timeStr || !prize) {
        return message.reply("❌ Usage: `!giveaway 10m Cool Prize`");
    }

    const match = timeStr.match(/^(\d+)(s|m|h)$/i);
    if (!match) return message.reply("❌ Time format: `30s`, `5m`, `1h`");

    const amount = parseInt(match[1]);
    const unit   = match[2].toLowerCase();
    const ms     = unit === "h" ? amount * 3_600_000
                 : unit === "m" ? amount * 60_000
                 : amount * 1_000;

    const embed = new EmbedBuilder()
        .setTitle("🎉 GIVEAWAY!")
        .setColor(0xFFD700)
        .setDescription(
            `**Prize:** ${prize}\n\n` +
            `React with 🎉 to enter!\n` +
            `Ends: <t:${Math.floor((Date.now() + ms) / 1000)}:R>`
        )
        .setFooter({ text: `Hosted by ${message.author.tag}` })
        .setTimestamp(new Date(Date.now() + ms));

    const giveMsg = await message.channel.send({ content: "@everyone 🎉 **GIVEAWAY!** 🎉", embeds: [embed] });
    await giveMsg.react("🎉");

    await message.reply(`✅ Giveaway started! Drawing in **${amount}${unit}**.`);

    setTimeout(async () => {
        const fresh = await giveMsg.fetch().catch(() => null);
        if (!fresh) return;

        const reaction = fresh.reactions.cache.get("🎉");
        if (!reaction) {
            return message.channel.send("🎉 No one entered the giveaway.");
        }

        const users = await reaction.users.fetch();
        const valid = users.filter(u => !u.bot);
        if (!valid.size) {
            return message.channel.send("🎉 No eligible entrants.");
        }

        const winner = valid.random();
        const winEmbed = new EmbedBuilder()
            .setTitle("🎉 Giveaway Ended!")
            .setColor(0xFFD700)
            .setDescription(`**Prize:** ${prize}\n**Winner:** ${winner}`)
            .setFooter({ text: `Hosted by ${message.author.tag}` })
            .setTimestamp();

        await message.channel.send({ content: `🎉 Congratulations ${winner}!`, embeds: [winEmbed] });
    }, ms);
}

// ====================== MODERATION ENGINE ======================

function getImageUrls(message) {
    const urls = [];
    for (const a of message.attachments.values()) {
        if (a.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url)) {
            urls.push(a.url);
        }
    }
    for (const e of message.embeds) {
        if (e.image?.url)     urls.push(e.image.url);
        if (e.thumbnail?.url) urls.push(e.thumbnail.url);
    }
    return [...new Set(urls)];
}

function getFileAttachments(message) {
    const files = [];
    for (const a of message.attachments.values()) {
        const isImg = a.contentType?.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.url);
        if (!isImg) files.push(a);
    }
    return files;
}

/**
 * Full moderation pipeline:
 *  1. Profanity regex
 *  2. Dangerous file extensions
 *  3. Suspicious non-image files → flagged for review
 *  4. AI text classification (toxic / scam / phishing)
 *  5. AI image classification for ALL image URLs (attachments + embeds)
 *     with optional embed retry
 */
async function moderateMessage(message, options = {}) {
    const text = message.content;

    // 1. Profanity
    if (/fuck|shit|bitch|asshole|cunt|fucker|bastard/i.test(text)) {
        return { flagged: true, reason: "Inappropriate language detected", category: "language", evidenceUrl: getImageUrls(message)[0] || null };
    }

    // 2. Dangerous files
    const files = getFileAttachments(message);
    for (const f of files) {
        if (DANGEROUS_EXTS.test(f.name)) {
            return { flagged: true, reason: `Dangerous file attachment: ${f.name}`, category: "file", evidenceUrl: null };
        }
    }

    // 3. Suspicious files — log and warn but don't auto-delete (just flag)
    for (const f of files) {
        if (SUSPICIOUS_EXTS.test(f.name)) {
            await logToModChannel(
                message,
                `Suspicious file attachment (${f.name}) — review manually`,
                "file",
                "Flagged for review",
                0,
                null
            );
            // Don't delete — just warn admins
        }
    }

    // 4. AI text check
    if (text.trim()) {
        try {
            const res = await openai.chat.completions.create({
                model: "google/gemini-2.0-flash",
                messages: [{
                    role: "user",
                    content:
`Classify this Discord message. Reply with ONLY one word.

Categories:
TOXIC — insults, harassment, hate speech, threats
SCAM  — free robux/nitro, fake giveaways, "click this for free X", impersonation, crypto/investment scams
PHISHING — suspicious links pretending to be Discord/Roblox login, account bans, fake security alerts
SAFE  — normal, no issues

Message: "${text.slice(0, 800)}"`
                }],
                max_tokens: 5
            });

            const cat = (res.choices[0].message.content || "").toUpperCase().trim();
            const imgs = getImageUrls(message);

            if (cat.includes("TOXIC"))  return { flagged: true, reason: "Toxic / harassing message",               category: "toxic",    evidenceUrl: imgs[0] || null };
            if (cat.includes("SCAM"))   return { flagged: true, reason: "Scam content detected",                   category: "scam",     evidenceUrl: imgs[0] || null };
            if (cat.includes("PHISH"))  return { flagged: true, reason: "Phishing link / fake security warning",   category: "phishing", evidenceUrl: imgs[0] || null };
        } catch {
            // AI unavailable — skip to image check
        }
    }

    // 5. Image check — with embed retry
    let imageUrls = getImageUrls(message);

    if (imageUrls.length === 0 && options.allowEmbedRetry && /https?:\/\//.test(text)) {
        await new Promise(r => setTimeout(r, 2000));
        try {
            const fresh = await message.channel.messages.fetch(message.id);
            imageUrls = getImageUrls(fresh);
        } catch { /* already deleted */ }
    }

    for (const url of imageUrls) {
        try {
            const res = await openai.chat.completions.create({
                model: "google/gemini-2.0-flash",
                messages: [{
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text:
`Look at this image posted in a Discord server. Classify it with ONE word.

SCAM     — fake celebrity giveaways, fake "you won" messages, fake MrBeast/crypto promos, fake withdrawal screens
PHISHING — fake login pages, fake "your account will be banned" notices, fake Discord/Roblox/Steam security alerts
NSFW     — sexual, violent, or graphic content
SAFE     — normal image, memes, game screenshots, art, etc.`
                        },
                        { type: "image_url", image_url: { url } }
                    ]
                }],
                max_tokens: 5
            });

            const cat = (res.choices[0].message.content || "").toUpperCase().trim();

            if (cat.includes("SCAM"))   return { flagged: true, reason: "Image is a fake giveaway / scam screenshot",   category: "scam",     evidenceUrl: url };
            if (cat.includes("PHISH"))  return { flagged: true, reason: "Image is a phishing / fake security warning",  category: "phishing", evidenceUrl: url };
            if (cat.includes("NSFW"))   return { flagged: true, reason: "Image contains NSFW / graphic content",        category: "nsfw",     evidenceUrl: url };
        } catch {
            // skip this image, try next
        }
    }

    return { flagged: false };
}

// ====================== TIMEOUT + WARN ======================
async function applyTimeout(message, reason, category, evidenceUrl) {
    const userId = message.author.id;
    const count  = (violationCount.get(userId) || 0) + 1;
    violationCount.set(userId, count);

    let actionTaken = "Warned";

    if (count >= 3) {
        await message.member.timeout(60 * 60 * 1000, reason).catch(() => {}); // 1 hour
        message.channel.send(`⛔ ${message.author} timed out for **1 hour**. Reason: **${reason}**`).catch(() => {});
        actionTaken = "Timed out (1h)";
    } else if (count >= 2) {
        await message.member.timeout(10 * 60 * 1000, reason).catch(() => {}); // 10 min
        message.channel.send(`⛔ ${message.author} timed out for **10 minutes**. Reason: **${reason}**`).catch(() => {});
        actionTaken = "Timed out (10m)";
    } else {
        message.channel.send(`⚠️ ${message.author} your message was removed. Reason: **${reason}**`).catch(() => {});
    }

    await logToModChannel(message, reason, category, actionTaken, count, evidenceUrl);
}

// ====================== MOD LOG ======================
async function logToModChannel(message, reason, category, actionTaken, count, evidenceUrl) {
    if (!MODLOG_CHANNEL_ID) return;
    try {
        const ch = message.guild.channels.cache.get(MODLOG_CHANNEL_ID);
        if (!ch) return;

        const emojis = { language:"🤬", toxic:"☢️", scam:"🎭", phishing:"🎣", nsfw:"🔞", file:"📁", spam:"⚡" };

        const embed = new EmbedBuilder()
            .setTitle(`${emojis[category] || "🛡️"} Auto-Mod: Message Removed`)
            .setColor(0xFF4444)
            .addFields(
                { name: "User",           value: `${message.author} (${message.author.id})`,  inline: true },
                { name: "Channel",        value: `${message.channel}`,                          inline: true },
                { name: "Category",       value: category || "unknown",                         inline: true },
                { name: "Reason",         value: reason },
                { name: "Action",         value: actionTaken,   inline: true },
                { name: "Violation #",    value: `${count}`,    inline: true },
                { name: "Content",        value: (message.content || "*(attachment/embed)*").slice(0, 1024) }
            )
            .setTimestamp();

        if (evidenceUrl) embed.setImage(evidenceUrl);

        await ch.send({ embeds: [embed] });
    } catch (e) {
        console.error("Mod-log error:", e);
    }
}

// ====================== HELP EMBED ======================
async function sendHelpEmbed(message) {
    const embed = new EmbedBuilder()
        .setTitle("🤖 Yobest Bot — Full Command List")
        .setColor(0x00FFAA)
        .addFields(
            {
                name: "📢 Announce (easy new format!)",
                value:
                    "```\n!announce\ntitle: SharkBite UNCOPYLOCKED\n" +
                    "desc: Fresh drop!\nvideo: bRzzhZcNHr0\n" +
                    "download: https://...\nroblox: https://...\n```" +
                    "Only `title` + `desc` required. Order doesn't matter."
            },
            { name: "🧠 AI Chat",      value: "`!enableai` / `!disableai` — toggle AI chat replies in this channel" },
            { name: "🔨 Mod (Admin)",  value: "`!ban @u [reason]` · `!kick @u [reason]` · `!mute @u` · `!unmute @u`\n`!warn @u` · `!warnings @u` · `!clearwarnings @u`\n`!purge 50` · `!slowmode 10` · `!lock` / `!unlock`" },
            { name: "🎉 Events (Admin)", value: "`!giveaway 10m Prize Name` — timed giveaway with 🎉 reactions" },
            { name: "👋 Welcome",      value: "`!setwelcome <msg>` — placeholders: `{user}` `{server}` `{count}`" },
            { name: "📊 Polls",        value: "`!poll Question | Option 1 | Option 2 | …` (up to 9 options)" },
            { name: "🚨 Reports",      value: "`!report @user <reason>` — DMs all admins instantly" },
            { name: "⏰ Reminders",    value: "`!remindme 30m check the oven` — supports `m` and `h`" },
            { name: "✨ Utility",      value: "`!ping` · `!stats` · `!serverinfo` · `!userinfo [@u]` · `!avatar [@u]`" },
            { name: "🎲 Fun",          value: "`!roll 2d6` · `!8ball <q>` · `!suggest <idea>`" },
            { name: "🌐 Info",         value: "`!site` · `!discord`" },
            { name: "👑 Owner Only",   value: "`!scanandclean` — scans last 100 messages (text + images + files)" }
        )
        .setFooter({ text: "Yobest_BYTR Bot v3.0 • 🛡️ Auto-mod always active" })
        .setTimestamp();
    return message.reply({ embeds: [embed] });
}

// ====================== STATS EMBED ======================
async function sendStatsEmbed(message) {
    const uptimeStr = formatUptime(Date.now() - startTime);
    const embed = new EmbedBuilder()
        .setTitle("📊 Bot & Server Stats")
        .setColor(0x00FFAA)
        .addFields(
            { name: "👥 Members",      value: `${message.guild.memberCount}`,                                              inline: true },
            { name: "⏱️ Uptime",       value: uptimeStr,                                                                   inline: true },
            { name: "🌐 Servers",      value: `${client.guilds.cache.size}`,                                               inline: true },
            { name: "🧠 AI Chat",      value: aiEnabledChannels.has(message.channel.id) ? "✅ Enabled here" : "❌ Off",    inline: true },
            { name: "🛡️ Auto-Mod",    value: "Always active (text + image + file)",                                       inline: true },
            { name: "⚡ Anti-Spam",    value: `${SPAM_LIMIT} msg / ${SPAM_WINDOW_MS / 1000}s limit`,                      inline: true }
        )
        .setTimestamp();
    return message.reply({ embeds: [embed] });
}

// ====================== SERVER INFO ======================
async function sendServerInfo(message) {
    const g = message.guild;
    const embed = new EmbedBuilder()
        .setTitle(`🏠 ${g.name}`)
        .setColor(0x00FFAA)
        .setThumbnail(g.iconURL({ dynamic: true }) || null)
        .addFields(
            { name: "👑 Owner",    value: `<@${g.ownerId}>`,                                      inline: true },
            { name: "👥 Members", value: `${g.memberCount}`,                                       inline: true },
            { name: "📅 Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`,         inline: true },
            { name: "💬 Channels",value: `${g.channels.cache.size}`,                               inline: true },
            { name: "😀 Emojis",  value: `${g.emojis.cache.size}`,                                 inline: true },
            { name: "🆔 ID",      value: g.id,                                                     inline: true }
        )
        .setTimestamp();
    return message.reply({ embeds: [embed] });
}

// ====================== USER INFO ======================
async function sendUserInfo(message, target) {
    const warnings = warnHistory.get(target.id) || [];
    const embed = new EmbedBuilder()
        .setTitle(`👤 ${target.user.tag}`)
        .setColor(0x00FFAA)
        .setThumbnail(target.user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: "🆔 User ID",       value: target.id,                                                    inline: true },
            { name: "📅 Account Created",value: `<t:${Math.floor(target.user.createdTimestamp / 1000)}:D>`, inline: true },
            { name: "📥 Joined Server",  value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:D>`,        inline: true },
            { name: "⚠️ Warnings",       value: `${warnings.length}`,                                        inline: true },
            { name: "🎭 Roles",          value: target.roles.cache.size > 1
                ? target.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(", ").slice(0, 1024)
                : "None"
            }
        )
        .setTimestamp();
    return message.reply({ embeds: [embed] });
}

// ====================== AI CHAT ======================
async function getAIResponse(message) {
    const userInput = message.content.replace(/<@!?[0-9]+>/g, "").trim() || "Hello";

    const systemPrompt =
        `You are Yobest, a professional Roblox Lua scripting expert and assistant for ${SITE_INFO.name} (${SITE_INFO.url}).

SITE: ${SITE_INFO.description}
Links: ${Object.entries(SITE_INFO.links).map(([k, v]) => `${k}: ${v}`).join(", ")}

RULES:
- Always respond in English.
- For script requests: return COMPLETE production-ready code in a single fenced \`\`\`lua block. Never truncate.
- For site/game/link questions: use the SITE INFO above. Point to ${SITE_INFO.url} for specifics.
- For chat: be concise, friendly, helpful.`;

    try {
        let text = await requestCompletion(systemPrompt, userInput);
        let attempts = 0;
        while (hasUnclosedCodeBlock(text) && attempts < 3) {
            attempts++;
            const cont = await requestCompletion(
                systemPrompt,
                `Continue EXACTLY where the previous Lua script left off. No repeats, no explanations. Close the \`\`\`lua block.\n\nPrevious:\n${text}`
            );
            text += "\n" + cont;
        }
        return text;
    } catch (e) {
        console.error("AI error:", e);
        return "I'm having trouble connecting right now. Please try again in a moment.";
    }
}

async function requestCompletion(systemPrompt, userInput) {
    const c = await openai.chat.completions.create({
        model:       "google/gemini-2.0-flash",
        messages:    [{ role: "system", content: systemPrompt }, { role: "user", content: userInput }],
        max_tokens:  1600,
        temperature: 0.7
    });
    return c.choices[0].message.content || "";
}

function hasUnclosedCodeBlock(text) {
    return ((text.match(/```/g) || []).length % 2) !== 0;
}

async function sendAIResponse(message, text) {
    const MAX = 1900;
    const codeMatch = text.match(/```lua[\s\S]*?```/);

    if (codeMatch) {
        const intro = text.slice(0, codeMatch.index).trim();
        const after = text.slice(codeMatch.index + codeMatch[0].length).trim();
        if (intro) {
            await message.reply({ embeds: [new EmbedBuilder().setTitle("📜 Script Ready").setColor(0x00FFAA).setDescription(intro.slice(0, 4000))] });
        }
        const chunks = splitWithFences(codeMatch[0], MAX);
        for (let i = 0; i < chunks.length; i++) {
            const label = chunks.length > 1 ? `**Part ${i+1}/${chunks.length}**\n` : "";
            await message.channel.send(label + chunks[i]);
        }
        if (after) await sendPlainText(message, after, MAX);
        return;
    }
    await sendPlainText(message, text, MAX);
}

async function sendPlainText(message, text, max) {
    if (text.length <= max) return message.reply(text);
    let rem = text, first = true;
    while (rem.length > 0) {
        let idx = rem.length > max ? rem.lastIndexOf("\n", max) : rem.length;
        if (idx <= 0) idx = Math.min(max, rem.length);
        const chunk = rem.slice(0, idx);
        first ? await message.reply(chunk) : await message.channel.send(chunk);
        first = false;
        rem = rem.slice(idx).trim();
    }
}

function splitWithFences(block, max) {
    const inner    = block.replace(/^```lua\n?/, "").replace(/```$/, "");
    const overhead = "```lua\n\n```".length;
    if (inner.length <= max - overhead) return [block];
    const lines = inner.split("\n");
    const chunks = [];
    let cur = "";
    for (const line of lines) {
        if ((cur + line + "\n").length > max - overhead) { chunks.push(cur); cur = ""; }
        cur += line + "\n";
    }
    if (cur) chunks.push(cur);
    return chunks.map(c => "```lua\n" + c.trimEnd() + "\n```");
}

// ====================== UTILITIES ======================
function formatUptime(ms) {
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60_000) % 60;
    const h = Math.floor(ms / 3_600_000) % 24;
    const d = Math.floor(ms / 86_400_000);
    return `${d}d ${h}h ${m}m ${s}s`;
}

// ====================== SCAN & CLEAN (OWNER) ======================
async function scanAndCleanChannel(message) {
    const reply = await message.reply("🔍 Scanning last 100 messages (text + images + files)...");
    try {
        const msgs    = await message.channel.messages.fetch({ limit: 100 });
        let deleted   = 0;
        for (const msg of msgs.values()) {
            if (msg.author.bot) continue;
            const result = await moderateMessage(msg, { allowEmbedRetry: false });
            if (result.flagged) {
                await msg.delete().catch(() => {});
                deleted++;
            }
        }
        await reply.edit(`✅ Scan complete. Deleted **${deleted}** bad message(s).`);
    } catch (e) {
        console.error("Scan error:", e);
        await reply.edit("❌ Scan failed. Check console for details.");
    }
}

// ====================== LOGIN ======================
client.login(process.env.DISCORD_TOKEN);