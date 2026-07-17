const {
  GIFT_CODE_CHANNEL_ID,
  GUILD_ID,
  LOG_CHANNEL_ID,
  AUTO_REDEEM_GIFT_CODES,
  GIFT_CODE_REDEEM_ENDPOINT,
  GIFT_CODE_REDEEM_TIMEOUT_MS,
} = require("../config");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionsBitField,
} = require("discord.js");
const { loadData, loadSentCodes, saveSentCodes } = require("./db");

const FORCE_VALID_GIFT_CODE_BUTTON_ID = "gift_code_force_valid";
const INVALID_GIFT_CODE_LOG_PREFIX = "⚠️ Suspicious Kingshot gift code format received:";

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

function normalizeGiftCode(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isValidGiftCode(value) {
  return /^[A-Z]+[0-9]*$/.test(normalizeGiftCode(value));
}

function getGiftCodeCreatedTime(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
}

function extractGiftCodeFromInvalidLogMessage(content) {
  if (typeof content !== "string") return "";

  if (!content.startsWith(INVALID_GIFT_CODE_LOG_PREFIX)) return "";
  const match = content.match(/`([^`]*)`/);
  return normalizeGiftCode(match?.[1] || "");
}

function parseRedeemResult(payload) {
  if (!payload || typeof payload !== "object") {
    return { success: false, message: "Invalid redeem API response." };
  }

  const success =
    payload.status === "success" ||
    payload.success === true ||
    payload.ok === true ||
    payload.code === 0;

  const message =
    payload.message ||
    payload.msg ||
    payload.error ||
    payload.reason ||
    payload?.data?.message ||
    (success ? "Redeemed successfully." : "Redeem failed.");

  return { success, message: String(message) };
}

async function redeemGiftCodeForPlayer(kingshotId, code) {
  if (!GIFT_CODE_REDEEM_ENDPOINT) {
    return { success: false, message: "Redeem endpoint is not configured." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GIFT_CODE_REDEEM_TIMEOUT_MS);

  try {
    const res = await fetch(GIFT_CODE_REDEEM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: kingshotId,
        code,
        giftCode: code,
      }),
      signal: controller.signal,
    });

    const payload = await res.json().catch(() => ({}));
    const parsed = parseRedeemResult(payload);

    if (!res.ok) {
      return {
        success: false,
        message: `HTTP ${res.status}${parsed.message ? `: ${parsed.message}` : ""}`,
      };
    }

    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") {
      return { success: false, message: "Redeem request timed out." };
    }

    return { success: false, message: error?.message || "Redeem request failed." };
  } finally {
    clearTimeout(timeout);
  }
}

async function autoRedeemCodeForMembers(code) {
  const db = loadData();
  const members = Object.values(db).filter((entry) => entry?.kingshotId);

  if (members.length === 0) {
    return {
      total: 0,
      successCount: 0,
      failedCount: 0,
      sampleFailures: [],
    };
  }

  let successCount = 0;
  const failures = [];

  for (const member of members) {
    const result = await redeemGiftCodeForPlayer(member.kingshotId, code);
    if (result.success) {
      successCount += 1;
      continue;
    }

    failures.push(`${member.lastKnownName || member.discordTag || member.kingshotId}: ${result.message}`);
  }

  return {
    total: members.length,
    successCount,
    failedCount: failures.length,
    sampleFailures: failures.slice(0, 5),
  };
}

async function sendAutoRedeemFailuresToLogs(guild, code, stats) {
  if (!LOG_CHANNEL_ID || !stats || stats.failedCount === 0) return;

  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID) || await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel) {
    console.error("Log channel not found — check LOG_CHANNEL_ID.");
    return;
  }

  let content =
    `⚠️ Auto-redeem failures for gift code \`${code}\`\n` +
    `Success: ${stats.successCount}/${stats.total}\n` +
    `Failed: ${stats.failedCount}`;

  if (stats.sampleFailures.length > 0) {
    content += `\nSample failures: ${stats.sampleFailures.join(" | ")}`;
  }

  if (content.length > 1900) {
    content = `${content.slice(0, 1897)}...`;
  }

  await logChannel.send({
    content,
    flags: MessageFlags.SuppressNotifications,
  });
}

async function processGiftCodeAsValid(guild, code, createdAt, sentCodes) {
  const normalizedCode = normalizeGiftCode(code);
  if (!normalizedCode) return;

  const channel = guild.channels.cache.get(GIFT_CODE_CHANNEL_ID) || await guild.channels.fetch(GIFT_CODE_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.error("Gift code channel not found — check GIFT_CODE_CHANNEL_ID.");
    return;
  }

  if (AUTO_REDEEM_GIFT_CODES) {
    const stats = await autoRedeemCodeForMembers(normalizedCode);
    await sendAutoRedeemFailuresToLogs(guild, normalizedCode, stats);
  }

  const createdAtLabel = formatDiscordTimestamp(createdAt || new Date().toISOString(), "f");

  await channel.send({
    content:
      `@everyone 🎁 **New Kingshot Gift Code**\n` +
      `Code: \`${normalizedCode}\`\n` +
      `Created: ${createdAtLabel}`
  });

  const targetSet = sentCodes || loadSentCodes();
  targetSet.add(normalizedCode);

  if (!sentCodes) {
    saveSentCodes(targetSet);
  }
}

async function sendInvalidGiftCodeToLogs(guild, code) {
  if (!LOG_CHANNEL_ID) return;

  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID) || await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
  if (!logChannel) {
    console.error("Log channel not found — check LOG_CHANNEL_ID.");
    return;
  }

  let content = `${INVALID_GIFT_CODE_LOG_PREFIX} \`${code}\``;

  if (content.length > 1900) {
    content = `${content.slice(0, 1897)}...`;
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FORCE_VALID_GIFT_CODE_BUTTON_ID)
      .setLabel("Treat as valid + redeem")
      .setStyle(ButtonStyle.Success)
  );

  await logChannel.send({
    content,
    components: [row],
    flags: MessageFlags.SuppressNotifications,
  });
}

async function handleForceValidGiftCodeButton(interaction) {
  if (!interaction.isButton() || interaction.customId !== FORCE_VALID_GIFT_CODE_BUTTON_ID) return false;

  const hasPermission = interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  if (!hasPermission) {
    await interaction.reply({
      content: "You need the Manage Server permission to approve suspicious gift codes.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const message = interaction.message;
  const code = extractGiftCodeFromInvalidLogMessage(message?.content || "");

  if (!code) {
    await interaction.reply({
      content: "Could not parse the gift code from this log message.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (message.content.includes("considered a correct gift code")) {
    await interaction.reply({
      content: "This suspicious gift code was already approved.",
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await processGiftCodeAsValid(interaction.guild, code, new Date().toISOString());

  const approvalNote = `✅ Manually approved by <@${interaction.user.id}> and considered a correct gift code.`;
  await message.edit({
    content: `${message.content}\n${approvalNote}`,
    components: [],
  });

  await interaction.editReply({
    content: `Approved \`${code}\`. Posted in <#${GIFT_CODE_CHANNEL_ID}> and auto-redeem was triggered.`,
  });

  return true;
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
    const newCodeEntries = giftCodeEntries
      .filter((entry) => {
      const code = normalizeGiftCode(entry?.code);
      return code && !sentCodes.has(code);
      })
      .sort((left, right) => getGiftCodeCreatedTime(left?.createdAt) - getGiftCodeCreatedTime(right?.createdAt));

    if (newCodeEntries.length === 0) {
      console.log("No new gift codes found.");
      return;
    }

    const guild = await client.guilds.fetch(GUILD_ID);

    for (const entry of newCodeEntries) {
      const code = normalizeGiftCode(entry.code);
      if (!isValidGiftCode(code)) {
        await sendInvalidGiftCodeToLogs(guild, code || String(entry.code ?? ""));
        if (code) {
          sentCodes.add(code);
        }
        continue;
      }

      await processGiftCodeAsValid(guild, code, entry.createdAt, sentCodes);
    }

    saveSentCodes(sentCodes);

    console.log(`Sent ${newCodeEntries.length} new gift code(s).`);
  } catch (err) {
    console.error("Failed to check gift codes:", err);
  }
}

module.exports = {
  fetchKingshotPlayer,
  checkGiftCodes,
  handleForceValidGiftCodeButton,
};
