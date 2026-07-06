require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const crypto = require("crypto");

// ============================================================
//  CONFIGURATION — fill these in before running
// ============================================================
const BOT_TOKEN                = process.env.BOT_TOKEN;
const GUILD_ID                 = "1516079671639408873";
const LOG_CHANNEL_ID           = null;                    // optional, set to null to disable
const CATEGORY_ID              = "1516724339003621387";   // optional, set to null to disable
const UNVERIFIED_ROLE_ID       = "1516820807295307806";   // role assigned on join, removed after verification — set to null to disable
const DB_FILE                  = "members_info.json";
const GIFT_CODE_CHANNEL_ID     = "1516080050250715237";   // channel to post gift codes — set to null to disable
const DISCORD_RULES_CHANNEL_ID = "1521537057371983872";   // channel where the bot posts server rules
const DISCORD_RULES_FILE       = "discord_rules.txt";             // edit this file to update the rules content
const SENT_CODES_FILE          = "sent_codes.json";
const REMINDER_CONFIG_FILE     = "reminder_config.json";  // persisted reminder settings (edit via /reminder slash commands)
const EVENT_TEMPLATES_FILE     = "event_templates.json";   // event templates
const RECURRING_EVENTS_FILE    = "recurring_events.json";  // recurring event schedules
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

function loadReminderConfig() {
  if (!fs.existsSync(REMINDER_CONFIG_FILE)) return { channelId: null, intervals: [1440, 60, 15] };
  return JSON.parse(fs.readFileSync(REMINDER_CONFIG_FILE, "utf-8"));
}

function saveReminderConfig(config) {
  fs.writeFileSync(REMINDER_CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ─────────────────────────────────────────────
//  Event template & recurring event helpers
// ─────────────────────────────────────────────
function loadEventTemplates() {
  if (!fs.existsSync(EVENT_TEMPLATES_FILE)) return {};
  return JSON.parse(fs.readFileSync(EVENT_TEMPLATES_FILE, "utf-8"));
}

function saveEventTemplates(data) {
  fs.writeFileSync(EVENT_TEMPLATES_FILE, JSON.stringify(data, null, 2));
}

function loadRecurringEvents() {
  if (!fs.existsSync(RECURRING_EVENTS_FILE)) return {};
  return JSON.parse(fs.readFileSync(RECURRING_EVENTS_FILE, "utf-8"));
}

function saveRecurringEvents(data) {
  fs.writeFileSync(RECURRING_EVENTS_FILE, JSON.stringify(data, null, 2));
}

// Parse "YYYY-MM-DD HH:MM" as UTC; returns a Date or null
function parseUtcDatetime(str) {
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return isNaN(d.getTime()) ? null : d;
}

// Create a Discord scheduled event (External type — no voice/stage channel required)
async function createDiscordEvent(guild, { name, description, location, durationMinutes, startTimestamp }) {
  const payload = {
    name,
    scheduledStartTime: new Date(startTimestamp),
    scheduledEndTime:   new Date(startTimestamp + durationMinutes * 60_000),
    privacyLevel: 2,   // GUILD_ONLY
    entityType:   3,   // EXTERNAL
    entityMetadata: { location: location || "TBD" },
  };
  if (description) payload.description = description;
  return guild.scheduledEvents.create(payload);
}

// Format an interval expressed in days into a human-readable string
function formatIntervalDays(days) {
  if (days >= 7 && Number.isInteger(days / 7)) return `every ${days / 7} week(s)`;
  if (days >= 1) return `every ${days} day(s)`;
  return `every ${Math.round(days * 24)} hour(s)`;
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
  const { channelId, intervals } = loadReminderConfig();
  if (!channelId) return;
  if (!event.scheduledStartTimestamp) return;
  if (event.status !== 1 /* SCHEDULED */) return;

  // Cancel any existing timeouts for this event before (re)scheduling
  cancelEventReminders(event.id);

  const now = Date.now();
  const timeouts = [];

  for (const intervalMin of intervals) {
    const delay = event.scheduledStartTimestamp - intervalMin * 60 * 1_000 - now;
    if (delay <= 0) continue; // reminder time already passed

    const label              = formatIntervalLabel(intervalMin);
    const capturedName        = event.name;
    const capturedDescription = event.description;
    const capturedStartTs     = event.scheduledStartTimestamp;
    const capturedId          = event.id;
    const capturedChannelId   = channelId; // capture now; config may change later

    const timeoutId = setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = guild.channels.cache.get(capturedChannelId);
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
//  Recurring event scheduler
// ─────────────────────────────────────────────
// Discord events are created this far in advance so all default reminder intervals can fire
const RECURRING_CREATE_AHEAD_MS = 48 * 60 * 60 * 1_000; // 48 hours

async function checkAndCreateRecurringEvents() {
  const recurring = loadRecurringEvents();
  const now = Date.now();
  let changed = false;

  let guild;
  try {
    guild = await client.guilds.fetch(GUILD_ID);
  } catch {
    return; // bot not ready yet
  }

  for (const [, rec] of Object.entries(recurring)) {
    if (!rec.active) continue;

    // Advance any past occurrences (1-min grace period for slight delays)
    while (rec.nextOccurrence < now - 60_000) {
      rec.nextOccurrence += rec.intervalMs;
      rec.nextScheduledAt = null;
      changed = true;
    }

    // Create the Discord event when inside the lookahead window and not yet created
    if (
      rec.nextOccurrence - now <= RECURRING_CREATE_AHEAD_MS &&
      rec.nextScheduledAt !== rec.nextOccurrence
    ) {
      try {
        await createDiscordEvent(guild, {
          name:            rec.name,
          description:     rec.description,
          location:        rec.location,
          durationMinutes: rec.durationMinutes,
          startTimestamp:  rec.nextOccurrence,
        });
        rec.nextScheduledAt = rec.nextOccurrence;
        rec.nextOccurrence += rec.intervalMs;
        changed = true;
        console.log(`Recurring: created Discord event "${rec.name}" at ${new Date(rec.nextScheduledAt).toISOString()}`);
      } catch (err) {
        console.error(`Recurring: failed to create Discord event "${rec.name}":`, err.message);
      }
    }
  }

  if (changed) saveRecurringEvents(recurring);
}

// Check every 5 minutes
cron.schedule("*/5 * * * *", () => {
  checkAndCreateRecurringEvents().catch(console.error);
});

// ─────────────────────────────────────────────
//  Rules content
// ─────────────────────────────────────────────
function buildRulesMessages() {
  if (!fs.existsSync(DISCORD_RULES_FILE)) throw new Error(`Rules file not found: ${DISCORD_RULES_FILE}`);
  const raw      = fs.readFileSync(DISCORD_RULES_FILE, "utf-8");
  const sections = raw.split(/^---$/m).map((s) => s.trim()).filter(Boolean);
  const colors   = [0xF5A623, 0xE74C3C, 0x3498DB, 0x2ECC71, 0x9B59B6];

  return sections.map((section, i) => {
    const newlineIdx = section.indexOf("\n");
    const title      = (newlineIdx === -1 ? section : section.slice(0, newlineIdx)).trim();
    const body       = (newlineIdx === -1 ? "" : section.slice(newlineIdx + 1)).trim();

    const embed = new EmbedBuilder().setColor(colors[i] ?? 0x95A5A6);
    if (title) embed.setTitle(title);
    if (body)  embed.setDescription(body);
    if (i === sections.length - 1) embed.setFooter({ text: "Kingshot Alliance" });

    return { embeds: [embed] };
  });
}

// ─────────────────────────────────────────────
//  Slash commands — /reminder
// ─────────────────────────────────────────────
const reminderCommand = new SlashCommandBuilder()
  .setName("reminder")
  .setDescription("Configure event reminders")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("channel")
      .setDescription("Set the channel where reminders are posted")
      .addChannelOption((opt) =>
        opt.setName("channel").setDescription("The target channel").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("intervals")
      .setDescription("Set reminder intervals (minutes before event start)")
      .addStringOption((opt) =>
        opt
          .setName("minutes")
          .setDescription("Space or comma-separated positive integers, e.g. 1440 60 15")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Show current reminder configuration")
  )
  .addSubcommand((sub) =>
    sub.setName("disable").setDescription("Disable event reminders")
  );

// ─────────────────────────────────────────────
//  Slash commands — /event
// ─────────────────────────────────────────────
const eventCommand = new SlashCommandBuilder()
  .setName("event")
  .setDescription("Create and manage guild events")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
  // ── /event create ───────────────────────────────────────
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Schedule a one-time event")
      .addStringOption((opt) =>
        opt.setName("start").setDescription("Start time — YYYY-MM-DD HH:MM (UTC)").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("template").setDescription("Pre-fill from a saved template").setRequired(false).setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Event name (overrides template)").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("description").setDescription("Description (overrides template)").setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt.setName("duration").setDescription("Duration in minutes (overrides template)").setRequired(false).setMinValue(1)
      )
      .addStringOption((opt) =>
        opt.setName("location").setDescription("Location (overrides template)").setRequired(false)
      )
  )
  // ── /event template * ───────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("template")
      .setDescription("Manage event templates")
      .addSubcommand((sub) =>
        sub
          .setName("save")
          .setDescription("Save a new event template")
          .addStringOption((opt) =>
            opt.setName("name").setDescription("Template name").setRequired(true)
          )
          .addIntegerOption((opt) =>
            opt.setName("duration").setDescription("Duration in minutes").setRequired(true).setMinValue(1)
          )
          .addStringOption((opt) =>
            opt.setName("description").setDescription("Event description").setRequired(false)
          )
          .addStringOption((opt) =>
            opt.setName("location").setDescription("Location (default: TBD)").setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("List all saved templates")
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Delete a template")
          .addStringOption((opt) =>
            opt.setName("name").setDescription("Template key").setRequired(true).setAutocomplete(true)
          )
      )
  )
  // ── /event recurring * ──────────────────────────────────
  .addSubcommandGroup((group) =>
    group
      .setName("recurring")
      .setDescription("Manage recurring events")
      .addSubcommand((sub) =>
        sub
          .setName("add")
          .setDescription("Add a recurring event")
          .addStringOption((opt) =>
            opt.setName("start").setDescription("First occurrence — YYYY-MM-DD HH:MM (UTC)").setRequired(true)
          )
          .addNumberOption((opt) =>
            opt
              .setName("interval_days")
              .setDescription("Repeat every N days (e.g. 2 → every 2 days; 0.5 → every 12 h)")
              .setRequired(true)
              .setMinValue(0.042)
          )
          .addStringOption((opt) =>
            opt.setName("template").setDescription("Pre-fill from a saved template").setRequired(false).setAutocomplete(true)
          )
          .addStringOption((opt) =>
            opt.setName("name").setDescription("Event name (overrides template)").setRequired(false)
          )
          .addStringOption((opt) =>
            opt.setName("description").setDescription("Description (overrides template)").setRequired(false)
          )
          .addIntegerOption((opt) =>
            opt.setName("duration").setDescription("Duration in minutes (overrides template)").setRequired(false).setMinValue(1)
          )
          .addStringOption((opt) =>
            opt.setName("location").setDescription("Location (overrides template)").setRequired(false)
          )
      )
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("List all active recurring events")
      )
      .addSubcommand((sub) =>
        sub
          .setName("remove")
          .setDescription("Stop a recurring event")
          .addStringOption((opt) =>
            opt.setName("id").setDescription("Recurring event ID").setRequired(true).setAutocomplete(true)
          )
      )
  );

// ─────────────────────────────────────────────
//  Slash commands — /rules
// ─────────────────────────────────────────────
const rulesCommand = new SlashCommandBuilder()
  .setName("rules")
  .setDescription("Manage server rules")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName("post").setDescription("(Re)post the server rules in the rules channel")
  );

// ─────────────────────────────────────────────
//  Autocomplete handler
// ─────────────────────────────────────────────
async function handleAutocomplete(interaction) {
  if (interaction.commandName !== "event") return;

  const group   = interaction.options.getSubcommandGroup(false);
  const sub     = interaction.options.getSubcommand();
  const focused = interaction.options.getFocused(true);

  // Template key autocomplete (template option in create/recurring add, and name in template delete)
  if (
    focused.name === "template" ||
    (group === "template" && sub === "delete" && focused.name === "name")
  ) {
    const templates = loadEventTemplates();
    const query     = focused.value.toLowerCase();
    const choices   = Object.entries(templates)
      .filter(([key, t]) => key.includes(query) || t.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map(([key, t]) => ({ name: `${t.name} (${t.durationMinutes} min)`, value: key }));
    return interaction.respond(choices);
  }

  // Recurring event ID autocomplete (for /event recurring remove)
  if (group === "recurring" && sub === "remove" && focused.name === "id") {
    const recurring = loadRecurringEvents();
    const query     = focused.value.toLowerCase();
    const choices   = Object.entries(recurring)
      .filter(([id, r]) => r.active && (id.includes(focused.value) || r.name.toLowerCase().includes(query)))
      .slice(0, 25)
      .map(([id, r]) => ({
        name: `${r.name} — next: ${new Date(r.nextOccurrence).toISOString().slice(0, 10)} (${formatIntervalDays(r.intervalDays)})`,
        value: id,
      }));
    return interaction.respond(choices);
  }

  await interaction.respond([]);
}

// ─────────────────────────────────────────────
//  /event command handler
// ─────────────────────────────────────────────
async function handleEventCommand(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub   = interaction.options.getSubcommand();

  // ── /event create ─────────────────────────────────────
  if (!group && sub === "create") {
    const startStr    = interaction.options.getString("start");
    const templateKey = interaction.options.getString("template");

    let name, description, durationMinutes, location;

    if (templateKey) {
      const tpl = loadEventTemplates()[templateKey];
      if (!tpl) return interaction.reply({ content: `❌ Template \`${templateKey}\` not found.`, ephemeral: true });
      ({ name, description, durationMinutes, location } = tpl);
    }

    name            = interaction.options.getString("name")        ?? name;
    description     = interaction.options.getString("description") ?? description ?? "";
    durationMinutes = interaction.options.getInteger("duration")   ?? durationMinutes;
    location        = interaction.options.getString("location")    ?? location ?? "TBD";

    if (!name)            return interaction.reply({ content: "❌ Provide an event `name` or choose a `template`.", ephemeral: true });
    if (!durationMinutes) return interaction.reply({ content: "❌ Provide a `duration` (minutes) or choose a `template`.", ephemeral: true });

    const startDate = parseUtcDatetime(startStr);
    if (!startDate)                        return interaction.reply({ content: "❌ Invalid start time — use `YYYY-MM-DD HH:MM` (UTC).", ephemeral: true });
    if (startDate.getTime() <= Date.now()) return interaction.reply({ content: "❌ Start time must be in the future.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      await createDiscordEvent(guild, { name, description, location, durationMinutes, startTimestamp: startDate.getTime() });
      return interaction.editReply({
        content: `✅ Event **${name}** scheduled for <t:${Math.floor(startDate.getTime() / 1000)}:F>.`,
      });
    } catch (err) {
      console.error("Failed to create event:", err);
      return interaction.editReply({ content: "❌ Failed to create the event. Ensure the bot has the **Manage Events** permission." });
    }
  }

  // ── /event template save ──────────────────────────────
  if (group === "template" && sub === "save") {
    const rawName       = interaction.options.getString("name");
    const durationMinutes = interaction.options.getInteger("duration");
    const description   = interaction.options.getString("description") ?? "";
    const location      = interaction.options.getString("location")    ?? "TBD";

    const key       = rawName.toLowerCase().replace(/\s+/g, "_");
    const templates = loadEventTemplates();
    templates[key]  = { name: rawName, description, durationMinutes, location };
    saveEventTemplates(templates);

    return interaction.reply({
      content: `✅ Template \`${key}\` saved (**${rawName}**, ${durationMinutes} min, ${location}).`,
      ephemeral: true,
    });
  }

  // ── /event template list ──────────────────────────────
  if (group === "template" && sub === "list") {
    const templates = loadEventTemplates();
    const keys = Object.keys(templates);
    if (keys.length === 0) return interaction.reply({ content: "📋 No templates saved yet.", ephemeral: true });
    const lines = keys.map((k) => {
      const t = templates[k];
      return `• \`${k}\` — **${t.name}** (${t.durationMinutes} min${t.location !== "TBD" ? `, ${t.location}` : ""})`;
    });
    return interaction.reply({ content: `📋 **Event templates:**\n${lines.join("\n")}`, ephemeral: true });
  }

  // ── /event template delete ────────────────────────────
  if (group === "template" && sub === "delete") {
    const key       = interaction.options.getString("name");
    const templates = loadEventTemplates();
    if (!templates[key]) return interaction.reply({ content: `❌ Template \`${key}\` not found.`, ephemeral: true });
    const displayName = templates[key].name;
    delete templates[key];
    saveEventTemplates(templates);
    return interaction.reply({ content: `🗑️ Template \`${key}\` (**${displayName}**) deleted.`, ephemeral: true });
  }

  // ── /event recurring add ──────────────────────────────
  if (group === "recurring" && sub === "add") {
    const startStr     = interaction.options.getString("start");
    const intervalDays = interaction.options.getNumber("interval_days");
    const templateKey  = interaction.options.getString("template");

    let name, description, durationMinutes, location;

    if (templateKey) {
      const tpl = loadEventTemplates()[templateKey];
      if (!tpl) return interaction.reply({ content: `❌ Template \`${templateKey}\` not found.`, ephemeral: true });
      ({ name, description, durationMinutes, location } = tpl);
    }

    name            = interaction.options.getString("name")        ?? name;
    description     = interaction.options.getString("description") ?? description ?? "";
    durationMinutes = interaction.options.getInteger("duration")   ?? durationMinutes;
    location        = interaction.options.getString("location")    ?? location ?? "TBD";

    if (!name)            return interaction.reply({ content: "❌ Provide an event `name` or choose a `template`.", ephemeral: true });
    if (!durationMinutes) return interaction.reply({ content: "❌ Provide a `duration` (minutes) or choose a `template`.", ephemeral: true });

    const startDate = parseUtcDatetime(startStr);
    if (!startDate)                        return interaction.reply({ content: "❌ Invalid start time — use `YYYY-MM-DD HH:MM` (UTC).", ephemeral: true });
    if (startDate.getTime() <= Date.now()) return interaction.reply({ content: "❌ First occurrence must be in the future.", ephemeral: true });

    const id         = crypto.randomUUID();
    const intervalMs = intervalDays * 24 * 60 * 60 * 1_000;
    const recurring  = loadRecurringEvents();

    recurring[id] = {
      name,
      description,
      durationMinutes,
      location,
      intervalDays,
      intervalMs,
      nextOccurrence:  startDate.getTime(),
      nextScheduledAt: null,
      active:          true,
      createdAt:       new Date().toISOString(),
    };
    saveRecurringEvents(recurring);

    await interaction.deferReply({ ephemeral: true });
    await checkAndCreateRecurringEvents(); // create Discord event now if within 48 h

    return interaction.editReply({
      content:
        `✅ Recurring event **${name}** added.\n` +
        `• ID: \`${id}\`\n` +
        `• First occurrence: <t:${Math.floor(startDate.getTime() / 1000)}:F>\n` +
        `• Repeats: ${formatIntervalDays(intervalDays)}`,
    });
  }

  // ── /event recurring list ─────────────────────────────
  if (group === "recurring" && sub === "list") {
    const recurring = loadRecurringEvents();
    const entries   = Object.entries(recurring).filter(([, r]) => r.active);
    if (entries.length === 0) return interaction.reply({ content: "📋 No recurring events configured.", ephemeral: true });
    const lines = entries.map(([id, r]) => {
      const nextTs = Math.floor(r.nextOccurrence / 1000);
      return `• \`${id.slice(0, 8)}…\` **${r.name}** — next: <t:${nextTs}:F> (${formatIntervalDays(r.intervalDays)})`;
    });
    return interaction.reply({
      content: `📋 **Recurring events:**\n${lines.join("\n")}\n\n*Use \`/event recurring remove\` (with autocomplete) to stop one.*`,
      ephemeral: true,
    });
  }

  // ── /event recurring remove ───────────────────────────
  if (group === "recurring" && sub === "remove") {
    const id        = interaction.options.getString("id");
    const recurring = loadRecurringEvents();
    if (!recurring[id]) return interaction.reply({ content: `❌ Recurring event \`${id}\` not found.`, ephemeral: true });
    const displayName = recurring[id].name;
    delete recurring[id];
    saveRecurringEvents(recurring);
    return interaction.reply({ content: `🔕 Recurring event **${displayName}** stopped.`, ephemeral: true });
  }
}

client.on("interactionCreate", async (interaction) => {
  // Autocomplete for /event options
  if (interaction.isAutocomplete()) {
    handleAutocomplete(interaction).catch(console.error);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  // ── /reminder ────────────────────────────────────────────
  if (interaction.commandName === "reminder") {
    const sub = interaction.options.getSubcommand();
    const config = loadReminderConfig();

    if (sub === "channel") {
      const ch = interaction.options.getChannel("channel");
      config.channelId = ch.id;
      saveReminderConfig(config);
      const guild = await client.guilds.fetch(GUILD_ID);
      const events = await guild.scheduledEvents.fetch();
      for (const [, event] of events) scheduleEventReminders(event);
      return interaction.reply({
        content: `✅ Reminders will now be posted in <#${ch.id}>.`,
        ephemeral: true,
      });
    }

    if (sub === "intervals") {
      const raw = interaction.options.getString("minutes");
      const parsed = raw
        .split(/[\s,]+/)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0);
      if (parsed.length === 0) {
        return interaction.reply({
          content: "⚠️ No valid intervals found. Provide positive integers separated by spaces or commas.",
          ephemeral: true,
        });
      }
      parsed.sort((a, b) => b - a);
      config.intervals = parsed;
      saveReminderConfig(config);
      const guild = await client.guilds.fetch(GUILD_ID);
      const events = await guild.scheduledEvents.fetch();
      for (const [, event] of events) scheduleEventReminders(event);
      return interaction.reply({
        content: `✅ Reminder intervals set to: **${parsed.map(formatIntervalLabel).join(", ")}**.`,
        ephemeral: true,
      });
    }

    if (sub === "status") {
      const channelMention = config.channelId ? `<#${config.channelId}>` : "*(disabled)*";
      const intervalLabels = config.intervals.length
        ? config.intervals.map(formatIntervalLabel).join(", ")
        : "*(none)*";
      return interaction.reply({
        content: `📋 **Reminder config:**\n• Channel: ${channelMention}\n• Intervals: ${intervalLabels}`,
        ephemeral: true,
      });
    }

    if (sub === "disable") {
      config.channelId = null;
      saveReminderConfig(config);
      reminderTimeouts.forEach((timeouts) => timeouts.forEach(clearTimeout));
      reminderTimeouts.clear();
      return interaction.reply({ content: "🔕 Reminders disabled.", ephemeral: true });
    }
  }

  // ── /event ───────────────────────────────────────────────
  if (interaction.commandName === "event") {
    handleEventCommand(interaction).catch(console.error);
  }

  // ── /rules ──────────────────────────────────────────────
  if (interaction.commandName === "rules") {
    const sub = interaction.options.getSubcommand();

    if (sub === "post") {
      await interaction.deferReply({ ephemeral: true });

      try {
        const guild   = await client.guilds.fetch(GUILD_ID);
        const channel = guild.channels.cache.get(DISCORD_RULES_CHANNEL_ID);
        if (!channel) {
          return interaction.editReply({ content: "❌ Rules channel not found — check `DISCORD_RULES_CHANNEL_ID`." });
        }

        // Delete existing bot messages in the rules channel
        const fetched = await channel.messages.fetch({ limit: 100 });
        const botMessages = fetched.filter((m) => m.author.id === client.user.id);
        if (botMessages.size > 0) {
          // bulkDelete only works for messages < 14 days old; fall back to individual deletes
          await channel.bulkDelete(botMessages, true).catch(async () => {
            for (const [, msg] of botMessages) {
              await msg.delete().catch(() => {});
            }
          });
        }

        // Post each rules message in order
        for (const payload of buildRulesMessages()) {
          await channel.send(payload);
        }

        return interaction.editReply({ content: `✅ Rules posted in <#${DISCORD_RULES_CHANNEL_ID}>.` });
      } catch (err) {
        console.error("Failed to post rules:", err);
        return interaction.editReply({ content: "❌ Failed to post rules. Check bot permissions." });
      }
    }
  }
});

// ─────────────────────────────────────────────
//  Ready
// ─────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);

  // Register guild slash commands
  try {
    const rest = new REST().setToken(BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: [reminderCommand.toJSON(), eventCommand.toJSON(), rulesCommand.toJSON()],
    });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }

  // Recover reminders for events that already existed when the bot started
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const events = await guild.scheduledEvents.fetch();
    for (const [, event] of events) scheduleEventReminders(event);
    console.log(`Scheduled reminders for ${events.size} existing event(s).`);
  } catch (err) {
    console.error("Failed to recover event reminders on startup:", err);
  }

  // Create Discord events for any recurring entries coming up within 48 h
  await checkAndCreateRecurringEvents().catch(console.error);
});

client.login(BOT_TOKEN);