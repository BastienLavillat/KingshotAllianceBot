const { GIFT_CODE_CHANNEL_ID, GUILD_ID } = require("../config");
const { loadSentCodes, saveSentCodes } = require("./db");

function formatDiscordTimestamp(value, style = "F") {
  if (!value) return "Never";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `<t:${Math.floor(parsed.getTime() / 1000)}:${style}>`;
}

async function fetchKingshotPlayer(kingshotId) {
  const res = await fetch(`https://kingshot.net/api/player-info?playerId=${kingshotId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (data.status !== "success") return null;
  return data.data.name; // adjust field name if needed
}

async function checkGiftCodes(client) {
  if (!GIFT_CODE_CHANNEL_ID) return;

  try {
    const res = await fetch("https://kingshot.net/api/gift-codes");
    if (!res.ok) {
      throw new Error(`Gift code API returned ${res.status}`);
    }

    const data = await res.json();
    const giftCodeEntries = Array.isArray(data?.data?.giftCodes) ? data.data.giftCodes : [];

    const sentCodes = loadSentCodes();
    const newCodeEntries = giftCodeEntries.filter((entry) => entry?.code && !sentCodes.has(entry.code));

    if (newCodeEntries.length === 0) {
      console.log("No new gift codes found.");
      return;
    }

    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = guild.channels.cache.get(GIFT_CODE_CHANNEL_ID);
    if (!channel) {
      console.error("Gift code channel not found — check GIFT_CODE_CHANNEL_ID.");
      return;
    }

    for (const [index, entry] of newCodeEntries.entries()) {
      const code = entry.code;
      const createdAt = formatDiscordTimestamp(entry.createdAt, "f");
      const expiresAt = formatDiscordTimestamp(entry.expiresAt, "f");
      const mentionPrefix = index === 0 ? "@everyone " : "";

      await channel.send({
        content:
          `${mentionPrefix}🎁 **New Kingshot Gift Code**\n` +
          `Code: \`${code}\`\n` +
          `Created: ${createdAt}\n` +
          `Expires: ${expiresAt}`,
        allowedMentions: index === 0 ? { parse: ["everyone"] } : { parse: [] },
      });

      sentCodes.add(code);
    }

    saveSentCodes(sentCodes);

    console.log(`Sent ${newCodeEntries.length} new gift code(s).`);
  } catch (err) {
    console.error("Failed to check gift codes:", err);
  }
}

module.exports = { fetchKingshotPlayer, checkGiftCodes };
