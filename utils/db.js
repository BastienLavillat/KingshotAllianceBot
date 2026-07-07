const fs = require("fs");
const {
  DB_FILE,
  SENT_CODES_FILE,
  REMINDER_CONFIG_FILE,
  EVENT_TEMPLATES_FILE,
  RECURRING_EVENTS_FILE,
} = require("../config");

function loadData() {
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "{}");
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function loadSentCodes() {
  if (!fs.existsSync(SENT_CODES_FILE)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(SENT_CODES_FILE, "utf-8")));
}

function saveSentCodes(codes) {
  fs.writeFileSync(SENT_CODES_FILE, JSON.stringify([...codes], null, 2));
}

function loadReminderConfig() {
  if (!fs.existsSync(REMINDER_CONFIG_FILE)) return { intervals: [1440, 60, 15] };
  return JSON.parse(fs.readFileSync(REMINDER_CONFIG_FILE, "utf-8"));
}

function saveReminderConfig(config) {
  fs.writeFileSync(REMINDER_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadEventTemplates() {
  if (!fs.existsSync(EVENT_TEMPLATES_FILE)) return {};
  return JSON.parse(fs.readFileSync(EVENT_TEMPLATES_FILE, "utf-8"));
}

function saveEventTemplates(data) {
  fs.writeFileSync(EVENT_TEMPLATES_FILE, JSON.stringify(data, null, 2));
}

function loadRecurringEvents() {
  if (!fs.existsSync(RECURRING_EVENTS_FILE)) return {};
  return JSON.parse(fs.readFileSync(RECURRING_EVENTS_FILE, "utf-8"));
}

function saveRecurringEvents(data) {
  fs.writeFileSync(RECURRING_EVENTS_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  loadData,
  saveData,
  loadSentCodes,
  saveSentCodes,
  loadReminderConfig,
  saveReminderConfig,
  loadEventTemplates,
  saveEventTemplates,
  loadRecurringEvents,
  saveRecurringEvents,
};
