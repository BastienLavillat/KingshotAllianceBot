const cron = require("node-cron");
const { GIFT_CODE_CHECK_CRON } = require("../config");
const { checkGiftCodes } = require("../utils/api");

function register(client) {
  if (!GIFT_CODE_CHECK_CRON) {
    console.log("Gift code scheduler disabled: GIFT_CODE_CHECK_CRON is empty.");
    return;
  }

  if (!cron.validate(GIFT_CODE_CHECK_CRON)) {
    console.error(`Gift code scheduler disabled: invalid cron expression "${GIFT_CODE_CHECK_CRON}".`);
    return;
  }

  // Run once on startup so existing unsent codes are posted without waiting for the next cron tick.
  checkGiftCodes(client).catch(console.error);

  cron.schedule(GIFT_CODE_CHECK_CRON, () => {
    checkGiftCodes(client).catch(console.error);
  });

  console.log(`Gift code scheduler registered (${GIFT_CODE_CHECK_CRON}).`);
}

module.exports = { register };
