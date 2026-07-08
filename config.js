const path = require("path");

// ============================================================
//  CONFIGURATION — fill these in before running
// ============================================================
const BOT_TOKEN                 = process.env.BOT_TOKEN;
const DATA_DIR                  = process.env.DATA_DIR || __dirname; // point this to a persistent folder in production
const GUILD_ID                  = "1516079671639408873";
const LOG_CHANNEL_ID            = "1523976785144840203";   // optional, set to null to disable
const CATEGORY_ID               = "1516724339003621387";   // optional, set to null to disable
const UNVERIFIED_ROLE_ID        = "1516820807295307806";   // role assigned on join, removed after verification — set to null to disable
const DB_FILE                   = path.join(DATA_DIR, "members_info.json");
const GIFT_CODE_CHANNEL_ID      = "1516080050250715237";   // channel to post gift codes — set to null to disable
const DISCORD_RULES_CHANNEL_ID  = "1521537057371983872";   // channel where the bot posts server rules
const DISCORD_RULES_FILE        = path.join(DATA_DIR, "discord_rules.txt");     // edit this file to update the rules content
const ALLIANCE_RULES_CHANNEL_ID = "1521537244916355233";   // channel where the bot posts alliance rules
const ALLIANCE_RULES_FILE       = path.join(DATA_DIR, "alliance_rules.txt");    // edit this file to update the alliance rules content
const SENT_CODES_FILE           = path.join(DATA_DIR, "sent_codes.json");
const REMINDER_CHANNEL_ID       = "1520880291470639256";   // channel to post event reminders — set to null to disable
const REMINDER_CONFIG_FILE      = path.join(DATA_DIR, "reminder_config.json");  // persisted reminder settings (edit intervals via /reminder command)
const TEMPLATES_CHANNEL_ID      = "1524308730173456534";   // channel to display event template embeds — set to channel ID string to enable
const EVENT_TEMPLATES_FILE      = path.join(DATA_DIR, "event_templates.json");  // event templates
const RECURRING_EVENTS_FILE     = path.join(DATA_DIR, "recurring_events.json"); // recurring event schedules
// ============================================================

module.exports = {
  BOT_TOKEN,
  DATA_DIR,
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
  TEMPLATES_CHANNEL_ID,
  EVENT_TEMPLATES_FILE,
  RECURRING_EVENTS_FILE,
};
