const fs = require("fs");
const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { GUILD_ID, DISCORD_RULES_CHANNEL_ID, DISCORD_RULES_FILE } = require("../config");

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

const rulesCommand = new SlashCommandBuilder()
  .setName("rules")
  .setDescription("Manage server rules")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub.setName("post").setDescription("(Re)post the server rules in the rules channel")
  );

async function handleRulesCommand(interaction, client) {
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

module.exports = { rulesCommand, handleRulesCommand };
