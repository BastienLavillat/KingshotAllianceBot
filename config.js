// ============================================================
//  CONFIGURATION — fill these in before running
// ============================================================
const BOT_TOKEN                 = process.env.BOT_TOKEN;
const GUILD_ID                  = "1516079671639408873";
const LOG_CHANNEL_ID            = null;                    // optional, set to null to disable
const CATEGORY_ID               = "1516724339003621387";   // optional, set to null to disable
const UNVERIFIED_ROLE_ID        = "1516820807295307806";   // role assigned on join, removed after verification — set to null to disable
const DB_FILE                   = "members_info.json";
const GIFT_CODE_CHANNEL_ID      = "1516080050250715237";   // channel to post gift codes — set to null to disable
const DISCORD_RULES_CHANNEL_ID  = "1521537057371983872";   // channel where the bot posts server rules
const DISCORD_RULES_FILE        = "discord_rules.txt";     // edit this file to update the rules content
const ALLIANCE_RULES_CHANNEL_ID = "1521537244916355233";  // channel where the bot posts alliance rules
const ALLIANCE_RULES_FILE       = "alliance_rules.txt";   // edit this file to update the alliance rules content
const SENT_CODES_FILE           = "sent_codes.json";
const REMINDER_CHANNEL_ID       = "1520880291470639256";   // channel to post event reminders — set to null to disable
const REMINDER_CONFIG_FILE      = "reminder_config.json";  // persisted reminder settings (edit intervals via /reminder command)
const EVENT_TEMPLATES_FILE      = "event_templates.json";  // event templates
const RECURRING_EVENTS_FILE     = "recurring_events.json"; // recurring event schedules
// ============================================================

module.exports = {
  BOT_TOKEN,
  GUILD_ID,
  LOG_CHANNEL_ID,
  CATEGORY_ID,
  UNVERIFIED_ROLE_ID,
  DB_FILE,
  GIFT_CODE_CHANNEL_ID,
  DISCORD_RULES_CHANNEL_ID,
  DISCORD_RULES_FILE,
  ALLIANCE_RULES_CHANNEL_ID,
  ALLIANCE_RULES_FILE,
  SENT_CODES_FILE,
  REMINDER_CHANNEL_ID,
  REMINDER_CONFIG_FILE,
  EVENT_TEMPLATES_FILE,
  RECURRING_EVENTS_FILE,
};
