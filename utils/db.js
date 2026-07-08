const fs = require("fs");
const path = require("path");
const {
  DB_FILE,
  SENT_CODES_FILE,
  REMINDER_CONFIG_FILE,
  EVENT_TEMPLATES_FILE,
  RECURRING_EVENTS_FILE,
} = require("../config");

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function ensureJsonFile(filePath, defaultValue) {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

function ensureTextFile(filePath, defaultValue = "") {
  ensureParentDir(filePath);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultValue);
  }
}

function loadData() {
  ensureJsonFile(DB_FILE, {});
  return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
}

function saveData(data) {
  ensureParentDir(DB_FILE);
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function loadSentCodes() {
  ensureJsonFile(SENT_CODES_FILE, []);
  if (!fs.existsSync(SENT_CODES_FILE)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(SENT_CODES_FILE, "utf-8")));
}

function saveSentCodes(codes) {
  ensureParentDir(SENT_CODES_FILE);
  fs.writeFileSync(SENT_CODES_FILE, JSON.stringify([...codes], null, 2));
}

function loadReminderConfig() {
  ensureJsonFile(REMINDER_CONFIG_FILE, { intervals: [1440, 60, 15] });
  return JSON.parse(fs.readFileSync(REMINDER_CONFIG_FILE, "utf-8"));
}

function saveReminderConfig(config) {
  ensureParentDir(REMINDER_CONFIG_FILE);
  fs.writeFileSync(REMINDER_CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadEventTemplates() {
  ensureJsonFile(EVENT_TEMPLATES_FILE, {});
  return JSON.parse(fs.readFileSync(EVENT_TEMPLATES_FILE, "utf-8"));
}

function saveEventTemplates(data) {
  ensureParentDir(EVENT_TEMPLATES_FILE);
  fs.writeFileSync(EVENT_TEMPLATES_FILE, JSON.stringify(data, null, 2));
}

function loadRecurringEvents() {
  ensureJsonFile(RECURRING_EVENTS_FILE, {});
  return JSON.parse(fs.readFileSync(RECURRING_EVENTS_FILE, "utf-8"));
}

function saveRecurringEvents(data) {
  ensureParentDir(RECURRING_EVENTS_FILE);
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
