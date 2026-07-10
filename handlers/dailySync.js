const cron = require("node-cron");
const { GUILD_ID, LOG_CHANNEL_ID } = require("../config");
const { loadData, saveData } = require("../utils/db");
const { fetchKingshotPlayer } = require("../utils/api");

function register(client) {
  // Daily sync — every day at 09:00
  cron.schedule("0 9 * * *", async () => {
    console.log("Running daily Kingshot name sync...");

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
}

module.exports = { register };
