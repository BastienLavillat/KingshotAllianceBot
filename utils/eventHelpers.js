const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { TEMPLATES_CHANNEL_ID } = require("../config");

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

// Format a reminder interval expressed in minutes
function formatIntervalLabel(intervalMin) {
  if (intervalMin >= 1440) return `${intervalMin / 1440} day(s)`;
  if (intervalMin >= 60)   return `${intervalMin / 60} hour(s)`;
  return `${intervalMin} minute(s)`;
}

// Build a rich embed for a single event template
function buildTemplateEmbed(key, template) {
  return new EmbedBuilder()
    .setTitle(template.name)
    .setColor(0x5865f2)
    .addFields(
      { name: "Duration",    value: `${template.durationMinutes} min`, inline: true },
      { name: "Location",    value: template.location || "TBD",         inline: true },
      { name: "Description", value: template.description || "—",        inline: false },
    )
    .setFooter({ text: `Template key: ${key}` });
}

// (Re-)post one embed per template in the dedicated templates channel.
// All previous bot messages in that channel are replaced.
async function refreshTemplatesChannel(client, templates) {
  if (!TEMPLATES_CHANNEL_ID) return;

  const channel = await client.channels.fetch(TEMPLATES_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  // Remove existing bot messages (up to 100)
  const fetched    = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (fetched) {
    const botMsgs = [...fetched.values()].filter((m) => m.author.id === client.user.id);
    if (botMsgs.length > 0) {
      // bulkDelete only works for messages < 14 days old
      await channel.bulkDelete(botMsgs).catch(async () => {
        for (const m of botMsgs) await m.delete().catch(() => {});
      });
    }
  }

  const keys = Object.keys(templates);
  if (keys.length === 0) {
    await channel.send({ content: "📋 No event templates saved yet. Use `/event template save` to add one." });
    return;
  }

  for (const key of keys) {
    const embed = buildTemplateEmbed(key, templates[key]);
    const row   = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`schedule_template:${key}`)
        .setLabel("Schedule Event")
        .setStyle(ButtonStyle.Primary),
    );
    await channel.send({ embeds: [embed], components: [row] });
  }
}

module.exports = { parseUtcDatetime, createDiscordEvent, formatIntervalDays, formatIntervalLabel, buildTemplateEmbed, refreshTemplatesChannel };
