const { CATEGORY_ID, UNVERIFIED_ROLE_ID } = require("../config");
const { loadData, saveData } = require("../utils/db");
const { fetchKingshotPlayer } = require("../utils/api");

// userId → channelId
const PENDING = new Map();

function register(client) {
  client.on("guildMemberAdd", async (member) => {
    const guild = member.guild;

    try {
      const channel = await guild.channels.create({
        name: `verify-identity`,
        type: 0, // text channel
        parent: CATEGORY_ID ?? undefined,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: ["ViewChannel"] },
          { id: member.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
          { id: client.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageChannels"] },
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

  client.on("guildMemberRemove", async (member) => {
    const db = loadData();
    if (db[member.id]) {
      delete db[member.id];
      saveData(db);
      console.log(`Removed ${member.user.tag} from database (left server).`);
    }

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
}

module.exports = { register };
