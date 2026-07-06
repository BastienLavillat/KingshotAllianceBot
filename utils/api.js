const { GIFT_CODE_CHANNEL_ID, GUILD_ID } = require("../config");
const { loadSentCodes, saveSentCodes } = require("./db");

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

module.exports = { fetchKingshotPlayer, checkGiftCodes };
