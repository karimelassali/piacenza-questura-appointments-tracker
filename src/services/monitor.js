const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs/promises');
const config = require('../config');
const logger = require('../utils/logger');
const detection = require('../utils/detection');

class MonitorService {
  async run() {
    let browser;
    try {
      logger.info('Starting booking monitor check...');
      browser = await chromium.launch({ 
        headless: config.monitor.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 }
      });

      const page = await context.newPage();
      
      await page.goto(config.bookingUrl, { waitUntil: 'networkidle', timeout: 60000 });
      logger.info('Page loaded, waiting for dynamic content...');
      await page.waitForTimeout(5000); 

      const availability = {
        found: false,
        dates: [],
        slots: [],
        screenshotPath: null
      };

      // Check current month
      logger.info('Checking current month...');
      const currentMonthResults = await this.detectAvailability(page);
      availability.dates.push(...currentMonthResults.dates);
      availability.slots.push(...currentMonthResults.slots);

      // Try to navigate to next month
      try {
        const nextButton = page.locator('button[aria-label*="Next Month"], button.ms-Calendar-nextMonth');
        if (await nextButton.isVisible()) {
          logger.info('Navigating to next month...');
          await nextButton.click();
          await page.waitForTimeout(3000);
          const nextMonthResults = await this.detectAvailability(page);
          availability.dates.push(...nextMonthResults.dates);
          availability.slots.push(...nextMonthResults.slots);
        }
      } catch (err) {
        logger.warn('Could not navigate to next month', { error: err.message });
      }

      // Cleanup and summarize
      availability.dates = [...new Set(availability.dates)];
      availability.slots = [...new Set(availability.slots)];
      availability.found = availability.dates.length > 0 || availability.slots.length > 0;

      // Always take a final screenshot
      const screenshotName = availability.found ? `availability_${Date.now()}.png` : `no_availability_${Date.now()}.png`;
      const screenshotPath = path.resolve(config.storage.screenshotsDir, screenshotName);
      await fs.mkdir(config.storage.screenshotsDir, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      availability.screenshotPath = screenshotPath;

      return availability;

      
    } catch (error) {
      logger.error('Monitor run failed', { error: error.message });
      throw error;
    } finally {
      if (browser) await browser.close();
    }
  }

  async detectAvailability(page) {
    const results = {
      dates: [],
      slots: []
    };

    // 1. Check for interactive calendar days
    const days = await page.locator('button[aria-label*="available"], .ms-Calendar-day--isAvailable').all();
    for (const day of days) {
      const ariaLabel = await day.getAttribute('aria-label');
      if (ariaLabel) results.dates.push(ariaLabel);
    }

    // 2. Check for time slot buttons (may require clicking a day first in some MS Bookings versions)
    // If no slots are immediately visible, we try to click the first available day if it exists
    if (days.length > 0) {
      try {
        await days[0].click();
        await page.waitForTimeout(1000);
      } catch (e) {}
    }

    const slotButtons = await page.locator('button').all();
    for (const button of slotButtons) {
      const text = await button.innerText();
      if (await button.isVisible() && await button.isEnabled() && detection.looksLikeTime(text)) {
        results.slots.push(text.trim());
      }
    }

    return results;
  }
}

module.exports = new MonitorService();
