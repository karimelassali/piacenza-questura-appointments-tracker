require('dotenv').config();

const config = {
  bookingUrl: process.env.BOOKING_URL,
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
  },
  monitor: {
    checkInterval: parseInt(process.env.CHECK_INTERVAL || '10', 10),
    headless: process.env.HEADLESS !== 'false',
    timezone: process.env.TIMEZONE || 'Europe/Rome',
  },
  storage: {
    stateFilePath: process.env.STATE_FILE_PATH || './storage/state.json',
    screenshotsDir: process.env.SCREENSHOTS_DIR || './screenshots',
  },
};

// Validation
if (!config.bookingUrl) {
  console.error('CRITICAL: BOOKING_URL is not defined in environment variables.');
}

if (!config.telegram.token || !config.telegram.chatId) {
  console.warn('WARNING: Telegram credentials are not fully defined.');
}

module.exports = config;
