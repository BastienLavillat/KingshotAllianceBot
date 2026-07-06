const cron = require("node-cron");
const { GUILD_ID } = require("../config");
const { loadRecurringEvents, saveRecurringEvents } = require("../utils/db");
const { createDiscordEvent } = require("../utils/eventHelpers");

// Discord events are created this far in advance so all default reminder intervals can fire
const RECURRING_CREATE_AHEAD_MS = 48 * 60 * 60 * 1_000; // 48 hours

async function checkAndCreateRecurringEvents(client) {
  const recurring = loadRecurringEvents();
  const now = Date.now();
  let changed = false;

  let guild;
  try {
    guild = await client.guilds.fetch(GUILD_ID);
  } catch {
    return; // bot not ready yet
  }

  for (const [, rec] of Object.entries(recurring)) {
    if (!rec.active) continue;

    // Advance any past occurrences (1-min grace period for slight delays)
    while (rec.nextOccurrence < now - 60_000) {
      rec.nextOccurrence += rec.intervalMs;
      rec.nextScheduledAt = null;
      changed = true;
    }

    // Create the Discord event when inside the lookahead window and not yet created
    if (
      rec.nextOccurrence - now <= RECURRING_CREATE_AHEAD_MS &&
      rec.nextScheduledAt !== rec.nextOccurrence
    ) {
      try {
        await createDiscordEvent(guild, {
          name:            rec.name,
          description:     rec.description,
          location:        rec.location,
          durationMinutes: rec.durationMinutes,
          startTimestamp:  rec.nextOccurrence,
        });
        rec.nextScheduledAt = rec.nextOccurrence;
        rec.nextOccurrence += rec.intervalMs;
        changed = true;
        console.log(`Recurring: created Discord event "${rec.name}" at ${new Date(rec.nextScheduledAt).toISOString()}`);
      } catch (err) {
        console.error(`Recurring: failed to create Discord event "${rec.name}":`, err.message);
      }
    }
  }

  if (changed) saveRecurringEvents(recurring);
}

function register(client) {
  // Check every 5 minutes
  cron.schedule("*/5 * * * *", () => {
    checkAndCreateRecurringEvents(client).catch(console.error);
  });
}

module.exports = { checkAndCreateRecurringEvents, register };
