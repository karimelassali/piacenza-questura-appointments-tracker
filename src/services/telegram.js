const fetch = require('node-fetch');
const fs = require('fs');
const FormData = require('form-data');
const config = require('../config');
const logger = require('../utils/logger');

class TelegramService {
  constructor() {
    this.token = config.telegram.token;
    this.chatId = config.telegram.chatId;
    this.baseUrl = `https://api.telegram.org/bot${this.token}`;
  }

  async sendMessage(text) {
    try {
      const response = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });

      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.description);
      }
      logger.info('Telegram message sent successfully');
    } catch (error) {
      logger.error('Failed to send Telegram message', { error: error.message });
    }
  }

  async sendPhoto(photoPath, caption) {
    try {
      const form = new FormData();
      form.append('chat_id', this.chatId);
      form.append('photo', fs.createReadStream(photoPath));
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');

      const response = await fetch(`${this.baseUrl}/sendPhoto`, {
        method: 'POST',
        body: form,
      });

      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.description);
      }
      logger.info('Telegram photo sent successfully');
    } catch (error) {
      logger.error('Failed to send Telegram photo', { error: error.message });
    }
  }

  formatAlertMessage(availability) {
    let message = `<b>🚨 lqa l-mowaaid! (Randez-vous lqinah!)</b>\n\n`;
    message += `<b>📅 l-iyam:</b> ${availability.dates.join(', ')}\n`;
    message += `<b>⏰ l-oqat:</b> ${availability.slots.slice(0, 10).join(', ')}${availability.slots.length > 10 ? '...' : ''}\n\n`;
    message += `<a href="${config.bookingUrl}">🔗 r-bat l-mowaid men hna</a>\n`;
    message += `\n<i>t-dar f: ${new Date().toLocaleString()}</i>`;
    return message;
  }

  formatNoAvailabilityMessage() {
    let message = `<b>ℹ️ ma-kayn hta mowaid</b>\n\n`;
    message += `l-monitor qelleb f had ch-ehar u ch-ehar l-jay u ma-lqa hta mowaid khawi.\n\n`;
    message += `<a href="${config.bookingUrl}">🔗 chouf l-pej men hna</a>\n`;
    message += `\n<i>t-qelleb f: ${new Date().toLocaleString()}</i>`;
    return message;
  }
}

module.exports = new TelegramService();
