const crypto = require("crypto");
const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { GUILD_ID } = require("../config");
const {
  loadEventTemplates,
  saveEventTemplates,
  loadRecurringEvents,
  saveRecurringEvents,
} = require("../utils/db");
const { parseUtcDatetime, createDiscordEvent, formatIntervalDays, refreshTemplatesChannel } = require("../utils/eventHelpers");
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");
const { checkAndCreateRecurringEvents } = require("../handlers/recurring");

function normalizeMultilineText(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\\n/g, "\n");
}

function toTemplateKey(name) {
  if (typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/\s+/g, "_");
}

function truncateForModal(value, maxLength) {
  const normalized = typeof value === "string" ? value : "";
  return normalized.slice(0, maxLength);
}

function getPrefilledEventName(name) {
  const normalized = truncateForModal(name, 100).trim();
  return normalized || "New Event";
}

function getNextHourUtcString() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCMinutes(0, 0, 0);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1);

  const year = nextHour.getUTCFullYear();
  const month = String(nextHour.getUTCMonth() + 1).padStart(2, "0");
  const day = String(nextHour.getUTCDate()).padStart(2, "0");
  const hour = String(nextHour.getUTCHours()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:00`;
}

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
        opt
          .setName("description")
          .setDescription("Description (overrides template). Use \\n for new line")
          .setRequired(false)
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
            opt
              .setName("description")
              .setDescription("Event description. Use \\n for new line")
              .setRequired(false)
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
            opt
              .setName("description")
              .setDescription("Description (overrides template). Use \\n for new line")
              .setRequired(false)
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

async function handleEventCommand(interaction, client) {
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
    description     = normalizeMultilineText(interaction.options.getString("description") ?? description ?? "");
    durationMinutes = interaction.options.getInteger("duration")   ?? durationMinutes;
    location        = interaction.options.getString("location")    ?? location ?? "TBD";

    if (templateKey) {
      return interaction.reply({
        content: "ℹ️ Creating from templates is button-only. Use **Schedule Event** under the template message.",
        ephemeral: true,
      });
    }

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
    const rawName         = interaction.options.getString("name");
    const durationMinutes = interaction.options.getInteger("duration");
    const description     = normalizeMultilineText(interaction.options.getString("description") ?? "");
    const location        = interaction.options.getString("location")    ?? "TBD";

    const key       = toTemplateKey(rawName);
    if (!key) return interaction.reply({ content: "❌ Template name cannot be empty.", ephemeral: true });
    const templates = loadEventTemplates();
    templates[key]  = { name: rawName, description, durationMinutes, location };
    saveEventTemplates(templates);
    refreshTemplatesChannel(client, templates).catch(console.error);

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
    refreshTemplatesChannel(client, templates).catch(console.error);
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
    description     = normalizeMultilineText(interaction.options.getString("description") ?? description ?? "");
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
    await checkAndCreateRecurringEvents(client); // create Discord event now if within 48 h

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

// ── Button: "Schedule Event" pressed on a template embed ────────────────────
async function handleTemplateButton(interaction) {
  const key      = interaction.customId.split(":")[1];
  const template = loadEventTemplates()[key];
  if (!template) {
    return interaction.reply({ content: "❌ Template not found. It may have been deleted.", ephemeral: true });
  }

  const defaultStartTime = getNextHourUtcString();
  const modalInstanceId = Date.now().toString(36);

  const modal = new ModalBuilder()
    .setCustomId(`schedule_modal:${key}:${modalInstanceId}`)
    .setTitle(`Schedule: ${template.name}`)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("event_name")
          .setLabel("Event name")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(100)
          .setValue(getPrefilledEventName(template.name))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("start_time")
          .setLabel("Start time (YYYY-MM-DD HH:MM UTC)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(defaultStartTime)
          .setPlaceholder("2026-07-15 20:00"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("event_description")
          .setLabel("Description")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
          .setValue((template.description || "").slice(0, 1000)),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("event_duration")
          .setLabel("Duration (minutes)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(String(template.durationMinutes ?? ""))
          .setPlaceholder("60"),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("event_location")
          .setLabel("Location")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(100)
          .setValue(truncateForModal(template.location || "TBD", 100)),
      ),
    );

  await interaction.showModal(modal);
}

// ── Modal submit: date entered after clicking Schedule Event ─────────────────
async function handleTemplateModal(interaction, client) {
  const key      = interaction.customId.split(":")[1];
  const template = loadEventTemplates()[key];
  if (!template) {
    return interaction.reply({ content: "❌ Template not found. It may have been deleted.", ephemeral: true });
  }

  const name = interaction.fields.getTextInputValue("event_name").trim();
  const startStr = interaction.fields.getTextInputValue("start_time").trim();
  const description = normalizeMultilineText(interaction.fields.getTextInputValue("event_description") ?? "");
  const durationRaw = interaction.fields.getTextInputValue("event_duration").trim();
  const locationRaw = interaction.fields.getTextInputValue("event_location") ?? "";
  const location = locationRaw.trim() || "TBD";
  const durationMinutes = Number.parseInt(durationRaw, 10);

  if (!name) {
    return interaction.reply({ content: "❌ Event name cannot be empty.", ephemeral: true });
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
    return interaction.reply({ content: "❌ Duration must be a whole number of minutes (>= 1).", ephemeral: true });
  }

  const startDate = parseUtcDatetime(startStr);
  if (!startDate) {
    return interaction.reply({ content: "❌ Invalid start time — use `YYYY-MM-DD HH:MM` (UTC).", ephemeral: true });
  }
  if (startDate.getTime() <= Date.now()) {
    return interaction.reply({ content: "❌ Start time must be in the future.", ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await createDiscordEvent(guild, {
      name,
      description,
      location,
      durationMinutes,
      startTimestamp:  startDate.getTime(),
    });
    return interaction.editReply({
      content: `✅ Event **${name}** scheduled for <t:${Math.floor(startDate.getTime() / 1000)}:F>.`,
    });
  } catch (err) {
    console.error("Failed to create event from template:", err);
    return interaction.editReply({ content: "❌ Failed to create the event. Ensure the bot has the **Manage Events** permission." });
  }
}

module.exports = {
  eventCommand,
  handleEventCommand,
  handleAutocomplete,
  handleTemplateButton,
  handleTemplateModal,
};
