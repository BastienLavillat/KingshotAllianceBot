const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { UNVERIFIED_ROLE_ID } = require("../config");
const { loadData, saveData } = require("../utils/db");
const { fetchKingshotPlayer } = require("../utils/api");

const memberCommand = new SlashCommandBuilder()
  .setName("member")
  .setDescription("Manage member profile links")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("setid")
      .setDescription("Set or restore a Kingshot Player ID for a member")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Member to link").setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("player_id")
          .setDescription("Kingshot Player ID (numbers only)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("missing")
      .setDescription("List members who are missing a stored Kingshot Player ID")
  );

async function handleMemberCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "setid") {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser("user", true);
    const kingshotId = interaction.options.getString("player_id", true).trim();

    if (!/^\d+$/.test(kingshotId)) {
      return interaction.editReply({
        content: "Invalid player ID. Use numbers only.",
      });
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      return interaction.editReply({
        content: "That user is not in this server.",
      });
    }

    const ingameName = await fetchKingshotPlayer(kingshotId).catch(() => null);
    if (!ingameName) {
      return interaction.editReply({
        content: "Player ID was not found in Kingshot API.",
      });
    }

    const db = loadData();
    const previous = db[targetUser.id] || {};

    db[targetUser.id] = {
      ...previous,
      discordTag: targetUser.tag,
      kingshotId,
      lastKnownName: ingameName,
      updatedAt: new Date().toISOString(),
    };

    saveData(db);

    let nicknameUpdated = false;
    try {
      await member.setNickname(ingameName);
      nicknameUpdated = true;
    } catch {
      nicknameUpdated = false;
    }

    if (UNVERIFIED_ROLE_ID) {
      await member.roles.remove(UNVERIFIED_ROLE_ID).catch(() => {});
    }

    return interaction.editReply({
      content:
        `Saved player ID for <@${targetUser.id}>.\n` +
        `In-game name: **${ingameName}**\n` +
        `Nickname updated: ${nicknameUpdated ? "yes" : "no"}`,
    });
  }

  if (sub === "missing") {
    const db = loadData();
    const members = await interaction.guild.members.fetch();

    const missing = members
      .filter((m) => !m.user.bot)
      .filter((m) => {
        const record = db[m.id];
        return !record || !record.kingshotId;
      })
      .map((m) => `<@${m.id}>`);

    if (missing.length === 0) {
      return interaction.reply({
        content: "All non-bot members have a stored player ID.",
        ephemeral: true,
      });
    }

    const preview = missing.slice(0, 50).join(", ");
    const extraCount = missing.length - Math.min(missing.length, 50);

    return interaction.reply({
      content:
        `Members missing player IDs: ${missing.length}\n` +
        preview +
        (extraCount > 0 ? `\n...and ${extraCount} more.` : ""),
      ephemeral: true,
    });
  }
}

module.exports = { memberCommand, handleMemberCommand };