const fs = require("fs");
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const {
  GUILD_ID,
  DISCORD_RULES_CHANNEL_ID, DISCORD_RULES_FILE,
  ALLIANCE_RULES_CHANNEL_ID, ALLIANCE_RULES_FILE,
} = require("../config");

const RULES_COLORS = [0xF5A623, 0xE74C3C, 0x3498DB, 0x2ECC71, 0x9B59B6, 0xE67E22, 0x1ABC9C];

function buildRulesMessages(rulesFile, fixedColor = null) {
  if (!fs.existsSync(rulesFile)) throw new Error(`Rules file not found: ${rulesFile}`);
  const raw      = fs.readFileSync(rulesFile, "utf-8");
  const sections = raw.split(/^---$/m).map((s) => s.trim()).filter(Boolean);

  return sections.map((section, i) => {
    const newlineIdx = section.indexOf("\n");
    const title      = (newlineIdx === -1 ? section : section.slice(0, newlineIdx)).trim();
    const body       = (newlineIdx === -1 ? "" : section.slice(newlineIdx + 1)).trim();

    const color = fixedColor ?? RULES_COLORS[i] ?? 0x95A5A6;
    const embed = new EmbedBuilder().setColor(color);
    if (title) embed.setTitle(title);
    if (body)  embed.setDescription(body);

    return { embeds: [embed] };
  });
}

const rulesCommand = new SlashCommandBuilder()
  .setName("rules")
  .setDescription("Manage server rules")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName("post")
      .setDescription("(Re)post rules in the appropriate channel")
      .addStringOption((opt) =>
        opt
          .setName("target")
          .setDescription("Which rules to post")
          .setRequired(true)
          .addChoices(
            { name: "Discord server rules", value: "discord" },
            { name: "Alliance rules",       value: "alliance" },
          )
      )
  );

async function handleRulesCommand(interaction, client) {
  const sub = interaction.options.getSubcommand();

  if (sub === "post") {
    await interaction.deferReply({ ephemeral: true });

    const target    = interaction.options.getString("target");
    const channelId = target === "alliance" ? ALLIANCE_RULES_CHANNEL_ID : DISCORD_RULES_CHANNEL_ID;
    const rulesFile = target === "alliance" ? ALLIANCE_RULES_FILE        : DISCORD_RULES_FILE;

    try {
      const guild   = await client.guilds.fetch(GUILD_ID);
      const channel = guild.channels.cache.get(channelId);
      if (!channel) {
        return interaction.editReply({ content: `❌ Rules channel not found — check the channel ID in \`config.js\`.` });
      }

      // Delete existing bot messages in the rules channel
      const fetched = await channel.messages.fetch({ limit: 100 });
      const botMessages = fetched.filter((m) => m.author.id === client.user.id);
      if (botMessages.size > 0) {
        await channel.bulkDelete(botMessages, true).catch(async () => {
          for (const [, msg] of botMessages) {
            await msg.delete().catch(() => {});
          }
        });
      }

      // Post each rules message in order
      for (const payload of buildRulesMessages(rulesFile, target === "alliance" ? 0x3498DB : null)) {
        await channel.send(payload);
      }

      return interaction.editReply({ content: `✅ Rules posted in <#${channelId}>.` });
    } catch (err) {
      console.error("Failed to post rules:", err);
      return interaction.editReply({ content: "❌ Failed to post rules. Check bot permissions." });
    }
  }
}

module.exports = { rulesCommand, handleRulesCommand };
