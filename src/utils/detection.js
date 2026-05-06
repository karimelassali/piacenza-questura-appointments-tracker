const logger = require('./logger');

/**
 * Smart detection utilities for Microsoft Bookings
 */
const detection = {
  /**
   * Check if an element is likely a time slot
   */
  looksLikeTime: (text) => {
    return /^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(text.trim());
  },

  /**
   * Check if an element is likely a date
   */
  looksLikeDate: (text) => {
    // Matches formats like "May 15", "15 May", "2024-05-15", etc.
    return /[A-Za-z]+\s\d{1,2}/.test(text) || /\d{1,2}\s[A-Za-z]+/.test(text);
  },

  /**
   * Filter and extract available slots from raw findings
   */
  extractAvailableSlots: (elements) => {
    return elements
      .filter(el => el.isClickable && !el.isDisabled)
      .map(el => el.text.trim())
      .filter(text => detection.looksLikeTime(text));
  },

  /**
   * Logic to determine if an element is effectively clickable
   */
  isClickable: async (element) => {
    const isVisible = await element.isVisible();
    const isEnabled = await element.isEnabled();
    return isVisible && isEnabled;
  }
};

module.exports = detection;
