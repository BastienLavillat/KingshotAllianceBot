const { GUILD_ID } = require("../config");
const { loadReminderConfig } = require("../utils/db");
const { formatIntervalLabel } = require("../utils/eventHelpers");

// eventId → [timeoutId, ...]
const reminderTimeouts = new Map();

function scheduleEventReminders(event, client) {
  const { channelId, intervals } = loadReminderConfig();
  if (!channelId) return;
  if (!event.scheduledStartTimestamp) return;
  if (event.status !== 1 /* SCHEDULED */) return;

  // Cancel any existing timeouts for this event before (re)scheduling
  cancelEventReminders(event.id);

  const now = Date.now();
  const timeouts = [];

  for (const intervalMin of intervals) {
    const delay = event.scheduledStartTimestamp - intervalMin * 60 * 1_000 - now;
    if (delay <= 0) continue; // reminder time already passed

    const label               = formatIntervalLabel(intervalMin);
    const capturedName        = event.name;
    const capturedDescription = event.description;
    const capturedStartTs     = event.scheduledStartTimestamp;
    const capturedId          = event.id;
    const capturedChannelId   = channelId; // capture now; config may change later

    const timeoutId = setTimeout(async () => {
      try {
        const guild = await client.guilds.fetch(GUILD_ID);
        const channel = guild.channels.cache.get(capturedChannelId);
        if (!channel) return;

        // Re-fetch to confirm the event is still scheduled
        const liveEvent = await guild.scheduledEvents.fetch(capturedId).catch(() => null);
        if (!liveEvent || liveEvent.status !== 1 /* SCHEDULED */) return;

        await channel.send({
          content:
            `@everyone ⏰ **Reminder:** **${capturedName}** starts in **${label}**!\n` +
            (capturedDescription ? `> ${capturedDescription}\n` : "") +
            `🗓️ <t:${Math.floor(capturedStartTs / 1000)}:F>`,
          allowedMentions: { parse: ["everyone"] },
        });

        console.log(`Sent reminder for "${capturedName}" (${label} before).`);
      } catch (err) {
        console.error(`Failed to send reminder for "${capturedName}":`, err);
      }
    }, delay);

    timeouts.push(timeoutId);
    const minutesUntilFire = Math.round(delay / 60_000);
    console.log(`Scheduled reminder for "${event.name}" in ${minutesUntilFire} min (${label} before start).`);
  }

  if (timeouts.length > 0) reminderTimeouts.set(event.id, timeouts);
}

function cancelEventReminders(eventId) {
  const timeouts = reminderTimeouts.get(eventId);
  if (!timeouts) return;
  timeouts.forEach(clearTimeout);
  reminderTimeouts.delete(eventId);
  console.log(`Cancelled reminders for event ${eventId}.`);
}

function register(client) {
  client.on("guildScheduledEventCreate", (event) => {
    scheduleEventReminders(event, client);
  });

  client.on("guildScheduledEventUpdate", (oldEvent, newEvent) => {
    if (newEvent.status === 3 /* COMPLETED */ || newEvent.status === 4 /* CANCELLED */) {
      cancelEventReminders(newEvent.id);
    } else if (oldEvent.scheduledStartTimestamp !== newEvent.scheduledStartTimestamp) {
      scheduleEventReminders(newEvent, client); // reschedule with updated time
    }
  });

  client.on("guildScheduledEventDelete", (event) => {
    cancelEventReminders(event.id);
  });
}

module.exports = { scheduleEventReminders, cancelEventReminders, reminderTimeouts, register };
