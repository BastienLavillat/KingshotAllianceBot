const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { GUILD_ID } = require("../config");
const { loadReminderConfig, saveReminderConfig } = require("../utils/db");
const { formatIntervalLabel } = require("../utils/eventHelpers");
const { scheduleEventReminders, reminderTimeouts } = require("../handlers/reminders");

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

async function handleReminderCommand(interaction, client) {
  const sub = interaction.options.getSubcommand();
  const config = loadReminderConfig();

  if (sub === "channel") {
    const ch = interaction.options.getChannel("channel");
    config.channelId = ch.id;
    saveReminderConfig(config);
    const guild = await client.guilds.fetch(GUILD_ID);
    const events = await guild.scheduledEvents.fetch();
    for (const [, event] of events) scheduleEventReminders(event, client);
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
    for (const [, event] of events) scheduleEventReminders(event, client);
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

module.exports = { reminderCommand, handleReminderCommand };
