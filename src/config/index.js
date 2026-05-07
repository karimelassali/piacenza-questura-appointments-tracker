require('dotenv').config();
const path = require('path');

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
  ai: {
    enabled: process.env.AI_ENABLED === 'true',
    apiUrl: process.env.AI_API_URL || 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKey: process.env.AI_API_KEY || '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',
    modelName: process.env.AI_MODEL_NAME || 'google/gemma-4-31b-it',
  },
  storage: {
    stateFilePath: process.env.STATE_FILE_PATH || './storage/state.json',
    screenshotsDir: process.env.SCREENSHOTS_DIR || './screenshots',
    debugDir: process.env.DEBUG_DIR || './debug',
  },
};

// Validation
if (!config.bookingUrl) {
  console.error('CRITICAL: BOOKING_URL is not defined in environment variables.');
}

module.exports = config;
