require("dotenv").config();
const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");

const { BOT_TOKEN, GUILD_ID } = require("./config");

const verificationHandler = require("./handlers/verification");
const remindersHandler    = require("./handlers/reminders");
const recurringHandler    = require("./handlers/recurring");
const dailySyncHandler    = require("./handlers/dailySync");
const giftCodesHandler    = require("./handlers/giftCodes");
const { handleForceValidGiftCodeButton } = require("./utils/api");

const { reminderCommand, handleReminderCommand } = require("./commands/reminder");
const {
  eventCommand,
  handleEventCommand,
  handleAutocomplete,
  handleTemplateButton,
  handleTemplateModal,
} = require("./commands/event");
const { rulesCommand, handleRulesCommand } = require("./commands/rules");
const { memberCommand, handleMemberCommand } = require("./commands/member");

console.log("BOT_TOKEN present:", !!process.env.BOT_TOKEN);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildScheduledEvents,
  ],
});

// Register all event-driven handlers
verificationHandler.register(client);
remindersHandler.register(client);
recurringHandler.register(client);
dailySyncHandler.register(client);
giftCodesHandler.register(client);

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    handleAutocomplete(interaction).catch(console.error);
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("schedule_template:")) {
    handleTemplateButton(interaction).catch(console.error);
    return;
  }

  if (interaction.isButton()) {
    const handled = await handleForceValidGiftCodeButton(interaction).catch((err) => {
      console.error(err);
      return false;
    });

    if (handled) return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("schedule_modal:")) {
    handleTemplateModal(interaction, client).catch(console.error);
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "reminder") {
    handleReminderCommand(interaction, client).catch(console.error);
  }

  if (interaction.commandName === "event") {
    handleEventCommand(interaction, client).catch(console.error);
  }

  if (interaction.commandName === "rules") {
    handleRulesCommand(interaction, client).catch(console.error);
  }

  if (interaction.commandName === "member") {
    handleMemberCommand(interaction, client).catch(console.error);
  }
});

// ─────────────────────────────────────────────
//  Ready
// ─────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ Bot ready as ${client.user.tag}`);

  // Register guild slash commands
  try {
    const rest = new REST().setToken(BOT_TOKEN);
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
      body: [reminderCommand.toJSON(), eventCommand.toJSON(), rulesCommand.toJSON(), memberCommand.toJSON()],
    });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }

  // Recover reminders for events that already existed when the bot started
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const events = await guild.scheduledEvents.fetch();
    for (const [, event] of events) remindersHandler.scheduleEventReminders(event, client);
    console.log(`Scheduled reminders for ${events.size} existing event(s).`);
  } catch (err) {
    console.error("Failed to recover event reminders on startup:", err);
  }

  // Create Discord events for any recurring entries coming up within 48 h
  await recurringHandler.checkAndCreateRecurringEvents(client).catch(console.error);
});

client.login(BOT_TOKEN);

