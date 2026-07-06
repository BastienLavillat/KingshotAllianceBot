// Parse "YYYY-MM-DD HH:MM" as UTC; returns a Date or null
function parseUtcDatetime(str) {
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return isNaN(d.getTime()) ? null : d;
}

// Create a Discord scheduled event (External type — no voice/stage channel required)
async function createDiscordEvent(guild, { name, description, location, durationMinutes, startTimestamp }) {
  const payload = {
    name,
    scheduledStartTime: new Date(startTimestamp),
    scheduledEndTime:   new Date(startTimestamp + durationMinutes * 60_000),
    privacyLevel: 2,   // GUILD_ONLY
    entityType:   3,   // EXTERNAL
    entityMetadata: { location: location || "TBD" },
  };
  if (description) payload.description = description;
  return guild.scheduledEvents.create(payload);
}

// Format an interval expressed in days into a human-readable string
function formatIntervalDays(days) {
  if (days >= 7 && Number.isInteger(days / 7)) return `every ${days / 7} week(s)`;
  if (days >= 1) return `every ${days} day(s)`;
  return `every ${Math.round(days * 24)} hour(s)`;
}

// Format a reminder interval expressed in minutes
function formatIntervalLabel(intervalMin) {
  if (intervalMin >= 1440) return `${intervalMin / 1440} day(s)`;
  if (intervalMin >= 60)   return `${intervalMin / 60} hour(s)`;
  return `${intervalMin} minute(s)`;
}

module.exports = { parseUtcDatetime, createDiscordEvent, formatIntervalDays, formatIntervalLabel };
