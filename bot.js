require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");

// ============================================================
//  CONFIGURATION — fill these in before running
// ============================================================
const BOT_TOKEN             = process.env.BOT_TOKEN;
const GUILD_ID              = "1516079671639408873";
const LOG_CHANNEL_ID        = null;                    // optional, set to null to disable
const CATEGORY_ID           = "1516724339003621387";   // optional, set to null to disable
const UNVERIFIED_ROLE_ID    = "1516820807295307806";   // role assigned on join, removed after verification — set to null to disable
const DB_FILE               = "members_info.json";
const GIFT_CODE_CHANNEL_ID  = "1516080050250715237";   // channel to post gift codes — set to null to disable
const SENT_CODES_FILE       = "sent_codes.json";
const REMINDER_CHANNEL_ID   = "1520880291470639256";                    // channel to post event reminders — set to null to disable
const REMINDER_INTERVALS_MIN = [1440, 60, 15];         // minutes before event start to send reminders (1440 = 24h, 60 = 1h, 15 = 15min)
// ============================================================

console.log("BOT_TOKEN present:", !!process.env.BOT_TOKEN);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildScheduledEvents,
  ],
});

// Tracks members currently in the verification process
// userId → channelId
const PENDING = new Map();

// Tracks scheduled reminder timeouts: eventId → [timeoutId, ...]
const reminderTimeouts = new Map();

// ─────────────────────────────────────────────
//  JSON helpers
// ─────────────────────────────────────────────
function loadData() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function loadSentCodes() {
  if (!fs.existsSync(SENT_CODES_FILE)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(SENT_CODES_FILE, "utf-8")));
}

function saveSentCodes(codes) {
  fs.writeFileSync(SENT_CODES_FILE, JSON.stringify([...codes], null, 2));
}

// ─────────────────────────────────────────────
//  Kingshot API
// ─────────────────────────────────────────────
async function fetchKingshotPlayer(kingshotId) {
  const res = await fetch(`https://kingshot.net/api/player-info?playerId=${kingshotId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (data.status !== "success") return null;
  return data.data.name; // adjust field name if needed
}

async function checkGiftCodes() {
  if (!GIFT_CODE_CHANNEL_ID) return;

  try {
    const res = await fetch("https://kingshot.net/api/gift-codes");
    const data = await res.json();
    const allCodes = data.data.giftCodes.map((entry) => entry.code);

    const sentCodes = loadSentCodes();
    const newCodes = allCodes.filter((code) => !sentCodes.has(code));

    if (newCodes.length === 0) {
      console.log("No new gift codes found.");
      return;
    }

    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = guild.channels.cache.get(GIFT_CODE_CHANNEL_ID);
    if (!channel) {
      console.error("Gift code channel not found — check GIFT_CODE_CHANNEL_ID.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    await channel.send({
      content:
        `@everyone 🎁 **New Kingshot Gift Codes (${today}):**\n` +
        newCodes.map((code) => `• \`${code}\``).join("\n"),
      allowedMentions: { parse: ["everyone"] },
    });

    newCodes.forEach((code) => sentCodes.add(code));
    saveSentCodes(sentCodes);

    console.log(`Sent ${newCodes.length} new gift code(s).`);
  } catch (err) {
    console.error("Failed to check gift codes:", err);
  }
}

// ─────────────────────────────────────────────
//  New member joins → create private channel
// ─────────────────────────────────────────────
client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;

  try {
    const channel = await guild.channels.create({
      name: `verify-identity`,
      type: 0, // text channel
      parent: CATEGORY_ID ?? undefined,
      permissionOverwrites: [
        {
          id: guild.roles.everyone,
          deny: ["ViewChannel"],
        },
        {
          id: member.id,
          allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
        },
        {
          id: client.user.id,
          allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageChannels"],
        },
      ],
    });

    PENDING.set(member.id, channel.id);

    if (UNVERIFIED_ROLE_ID) {
      await member.roles.add(UNVERIFIED_ROLE_ID).catch((err) =>
        console.error(`Failed to assign unverified role to ${member.user.tag}:`, err)
      );
    }

    await channel.send(
      `👑 Welcome to **${guild.name}**, <@${member.id}>!\n\n` +
      `Please send your **Kingshot Player ID** here to complete your registration.\n` +
      `You can find it by tapping your avatar in the top-left corner of the game.`
    );
  } catch (err) {
    console.error(`Failed to create verification channel for ${member.user.tag}:`, err);
  }
});

// ─────────────────────────────────────────────
//  Member leaves before completing verification
// ─────────────────────────────────────────────
client.on("guildMemberRemove", async (member) => {
  // Remove from database if present
  const db = loadData();
  if (db[member.id]) {
    delete db[member.id];
    saveData(db);
    console.log(`Removed ${member.user.tag} from database (left server).`);
  }

  // Delete pending verification channel if any
  if (!PENDING.has(member.id)) return;

  const channelId = PENDING.get(member.id);
  PENDING.delete(member.id);

  try {
    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    if (channel) await channel.delete("Member left before completing verification.");
  } catch (err) {
    console.error(`Failed to delete verification channel for ${member.user.tag}:`, err);
  }
});

// ─────────────────────────────────────────────
//  Member sends their Kingshot ID
// ─────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!PENDING.has(message.author.id)) return;

  const channelId = PENDING.get(message.author.id);
  if (message.channel.id !== channelId) return; // ignore other channels

  const kingshotId = message.content.trim();

  if (!/^\d+$/.test(kingshotId)) {
    return message.reply("⚠️ Invalid ID — please send numbers only.");
  }

  await message.reply("🔍 Looking up your account...");

  try {
    const ingameName = await fetchKingshotPlayer(kingshotId);

    if (!ingameName) {
      return message.reply("❌ Player ID not found. Please double-check and try again.");
    }

    const member = await message.guild.members.fetch(message.author.id);

    try {
      await member.setNickname(ingameName);
    } catch {
      // Bot cannot rename this member (owner or higher role) — notify them instead
      await message.channel.send(
        `⚠️ I don't have permission to rename you automatically.\n` +
        `Please set your nickname manually to: **${ingameName}**`
      );
    }

    // Save to JSON
    const db = loadData();
    db[message.author.id] = {
      discordTag: message.author.tag,
      kingshotId,
      lastKnownName: ingameName,
      updatedAt: new Date().toISOString(),
    };
    saveData(db);

    PENDING.delete(message.author.id);

    if (UNVERIFIED_ROLE_ID) {
      await member.roles.remove(UNVERIFIED_ROLE_ID).catch((err) =>
        console.error(`Failed to remove unverified role from ${member.user.tag}:`, err)
      );
    }

    await message.reply(
      `✅ Done! Your nickname is now **${ingameName}**.\n` +
      `This channel will be deleted in 5 seconds.`
    );

    setTimeout(() => message.channel.delete().catch(console.error), 5000);

  } catch (err) {
    console.error(err);
    message.reply("❌ Something went wrong. Please try again later.");
  }
});

// ─────────────────────────────────────────────
//  Daily sync — every day at 09:00
// ─────────────────────────────────────────────
cron.schedule("0 9 * * *", async () => {
  console.log("Running daily Kingshot name sync...");

  await checkGiftCodes();

  const db = loadData();
  const guild = await client.guilds.fetch(GUILD_ID);
  const logChannel = LOG_CHANNEL_ID ? guild.channels.cache.get(LOG_CHANNEL_ID) : null;

  for (const [userId, record] of Object.entries(db)) {
    try {
      const currentName = await fetchKingshotPlayer(record.kingshotId);
      if (!currentName) continue;

      if (currentName !== record.lastKnownName) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue; // member may have left the server

        const oldName = record.lastKnownName;

        try {
          await member.setNickname(currentName);
        } catch {
          console.warn(`Could not rename ${record.discordTag} (insufficient permissions).`);
        }

        db[userId].lastKnownName = currentName;
        db[userId].updatedAt = new Date().toISOString();

        console.log(`Updated ${record.discordTag}: ${oldName} → ${currentName}`);

        if (logChannel) {
          logChannel.send(
            `🔄 **Name update detected**\n` +
            `Discord: <@${userId}>\n` +
            `**${oldName}** → **${currentName}**`
          );
        }
      }
    } catch (err) {
      console.error(`Failed to sync ${record.discordTag}:`, err);
    }
  }

  saveData(db);
  console.log("Daily sync complete.");
});

// ─────────────────────────────────────────────
//  Event reminders — scheduled via setTimeout
// ─────────────────────────────────────────────
function formatIntervalLabel(intervalMin) {
  if (intervalMin >= 1440) return `${intervalMin / 1440} day(s)`;
  if (intervalMin >= 60)   return `${intervalMin / 60} hour(s)`;
  return `${intervalMin} minute(s)`;
}

function scheduleEventReminders(event) {
  if (!REMINDER_CHANNEL_ID) return;
  if (!event.scheduledStartTimestamp) return;
  if (event.status !== 1 /* SCHEDULED */) return;

  // Cancel any existing timeouts for this event before (re)scheduling
  cancelEventReminders(event.id);

  const now = Date.now();
  const timeouts = [];

  for (const intervalMin of REMINDER_INTERVALS_MIN) {
    const delay = event.scheduledStartTimestamp - intervalMin * 60 * 1_000 - now;
    if (delay <= 0) continue; // reminder time already passed

    const label = formatIntervalLabel(intervalMin);
    const capturedName        = event.name;
    const capturedDescription = event.description;
    const capturedStartTs     = event.scheduledStartTimestamp;
    const capturedId          = event.id;

    const timeoutId = setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = guild.channels.cache.get(REMINDER_CHANNEL_ID);
        if (!channel) return;

        // Re-fetch to confirm the event is still scheduled
        const liveEvent = await guild.scheduledEvents.fetch(capturedId).catch(() => null);
        if (!liveEvent || liveEvent.status !== 1 /* SCHEDULED */) return;

        await channel.send({
          content:
            `@everyone ⏰ **Reminder:** **${capturedName}** starts in **${label}**!\n` +
            (capturedDescription ? `> ${capturedDescription}\n` : "") +
            `🗓️ <t:${Math.floor(capturedStartTs / 1000)}:F>`,
          allowedMentions: { parse: ["everyone"] },
        });

        console.log(`Sent reminder for "${capturedName}" (${label} before).`);
      } catch (err) {
        console.error(`Failed to send reminder for "${capturedName}":`, err);
      }
    }, delay);

    timeouts.push(timeoutId);
    const minutesUntilFire = Math.round(delay / 60_000);
    console.log(`Scheduled reminder for "${event.name}" in ${minutesUntilFire} min (${label} before start).`);
  }

  if (timeouts.length > 0) reminderTimeouts.set(event.id, timeouts);
}

function cancelEventReminders(eventId) {
  const timeouts = reminderTimeouts.get(eventId);
  if (!timeouts) return;
  timeouts.forEach(clearTimeout);
  reminderTimeouts.delete(eventId);
  console.log(`Cancelled reminders for event ${eventId}.`);
}

// Schedule reminders when a new event is created
client.on("guildScheduledEventCreate", (event) => {
  scheduleEventReminders(event);
});

// Reschedule if the event is updated (time changed), cancel if it's cancelled
client.on("guildScheduledEventUpdate", (oldEvent, newEvent) => {
  if (newEvent.status === 3 /* COMPLETED */ || newEvent.status === 4 /* CANCELLED */) {
    cancelEventReminders(newEvent.id);
  } else if (oldEvent.scheduledStartTimestamp !== newEvent.scheduledStartTimestamp) {
    scheduleEventReminders(newEvent); // reschedule with updated time
  }
});

// Cancel reminders if the event is deleted
client.on("guildScheduledEventDelete", (event) => {
  cancelEventReminders(event.id);
});

// ─────────────────────────────────────────────
//  Ready
// ─────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);

  // Recover reminders for events that existed before the bot started
  if (REMINDER_CHANNEL_ID) {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const events = await guild.scheduledEvents.fetch();
      for (const [, event] of events) scheduleEventReminders(event);
      console.log(`Scheduled reminders for ${events.size} existing event(s).`);
    } catch (err) {
      console.error("Failed to recover event reminders on startup:", err);
    }
  }
});

client.login(BOT_TOKEN);