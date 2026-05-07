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

  formatAlertMessage(availability, aiResult = null) {
    let message = `🚨 <b>لقيت موعد متاح فـ Questura ديال Piacenza!</b>\n\n`;
    message += `📅 <b>التاريخ:</b> ${availability.dates.join(', ')}\n`;
    message += `⏰ <b>الوقت:</b> ${availability.slots.slice(0, 10).join(', ')}${availability.slots.length > 10 ? '...' : ''}\n\n`;
    
    if (aiResult && aiResult.darijaSummary) {
      message += `🤖 <b>تحليل AI:</b> ${aiResult.darijaSummary}\n`;
      message += `🎯 <b>نسبة التأكد:</b> ${aiResult.confidence}%\n\n`;
    }

    message += `<a href="${config.bookingUrl}">🔗 ر-باط ل-موعيد من هنا</a>\n`;
    message += `\n<i>ت-دار ف: ${new Date().toLocaleString('ar-MA')}</i>`;
    return message;
  }

  formatNoAvailabilityMessage(aiResult = null) {
    let message = `❌ <b>مزال ما بان حتى موعد جديد.</b>\n\n`;
    
    if (aiResult && aiResult.darijaSummary) {
      message += `🤖 <b>AI:</b> ${aiResult.darijaSummary}\n\n`;
    }

    message += `<a href="${config.bookingUrl}">🔗 شوف ل-باج من هنا</a>\n`;
    message += `\n<i>ت-قلب ف: ${new Date().toLocaleString('ar-MA')}</i>`;
    return message;
  }

  formatPossibleAvailabilityMessage(aiResult = null) {
    let message = `🤔 <b>كاين احتمال يكون تفتح موعد جديد، دخل تأكد بسرعة.</b>\n\n`;
    
    if (aiResult && aiResult.darijaSummary) {
      message += `🤖 <b>تحليل AI:</b> ${aiResult.darijaSummary}\n`;
      message += `🎯 <b>نسبة التأكد:</b> ${aiResult.confidence}%\n\n`;
    }

    message += `<a href="${config.bookingUrl}">🔗 دخل تشوف من هنا</a>\n`;
    message += `\n<i>ت-قلب ف: ${new Date().toLocaleString('ar-MA')}</i>`;
    return message;
  }

  formatSiteChangedMessage() {
    return `⚠️ <b>شكل الموقع تبدل شوية، ممكن نظام الفحص يحتاج تحديث.</b>\n\n<a href="${config.bookingUrl}">🔗 دخل تأكد يدوياً</a>`;
  }

  formatAIUnavailableMessage() {
    return `⚠️ <b>AI ما خدمش دابا، استعملت غير الفحص العادي.</b>`;
  }

  formatSuspiciousMessage() {
    return `🧐 <b>كاين شي حاجة مشبوهة فالموقع، الأفضل تدخل تشوف براسك.</b>`;
  }
}

module.exports = new TelegramService();
