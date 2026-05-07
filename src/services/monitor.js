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

      const results = await this.performFullCheck(page);

      // Always take a final screenshot for AI and storage
      const screenshotName = `check_${Date.now()}.png`;
      const screenshotPath = path.resolve(config.storage.screenshotsDir, screenshotName);
      await fs.mkdir(config.storage.screenshotsDir, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      results.screenshotPath = screenshotPath;

      return results;

    } catch (error) {
      logger.error('Monitor run failed', { error: error.message });
      throw error;
    } finally {
      if (browser) await browser.close();
    }
  }

  async performFullCheck(page) {
    const availability = {
      found: false,
      dates: [],
      slots: [],
      domText: '',
      screenshotPath: null,
      confidence: 'none'
    };

    // Check current month
    logger.info('Checking current month...');
    let currentMonthResults = await this.detectAvailability(page);
    
    if (currentMonthResults.confidence === 'none') {
      logger.info('No availability found on first try. Refreshing and retrying...');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(5000);
      currentMonthResults = await this.detectAvailability(page);
    }
    
    availability.dates.push(...currentMonthResults.dates);
    availability.slots.push(...currentMonthResults.slots);
    availability.domText += currentMonthResults.debug.htmlSnippet;

    // Try to navigate to next month
    try {
      const nextButton = page.locator('button[aria-label*="Next Month"], button.ms-Calendar-nextMonth');
      if (await nextButton.isVisible()) {
        logger.info('Navigating to next month...');
        await nextButton.click();
        await page.waitForTimeout(3000);
        let nextMonthResults = await this.detectAvailability(page);

        if (nextMonthResults.confidence === 'none') {
          logger.info('No availability in next month on first try. Refreshing and retrying...');
          await page.reload({ waitUntil: 'networkidle' });
          await page.waitForTimeout(5000);
          const nextButtonRetry = page.locator('button[aria-label*="Next Month"], button.ms-Calendar-nextMonth');
          if (await nextButtonRetry.isVisible()) {
            await nextButtonRetry.click();
            await page.waitForTimeout(3000);
            nextMonthResults = await this.detectAvailability(page);
          }
        }

        availability.dates.push(...nextMonthResults.dates);
        availability.slots.push(...nextMonthResults.slots);
        availability.domText += nextMonthResults.debug.htmlSnippet;
      }
    } catch (err) {
      logger.warn('Could not navigate to next month', { error: err.message });
    }

    availability.dates = [...new Set(availability.dates)];
    availability.slots = [...new Set(availability.slots)];
    availability.found = availability.dates.length > 0 || availability.slots.length > 0;
    availability.confidence = currentMonthResults.confidence;

    return availability;
  }

  async detectAvailability(page) {
    const results = {
      dates: [],
      slots: [],
      confidence: 'none',
      debug: {
        totalButtons: 0,
        availableDayButtons: 0,
        timeLikeButtons: 0,
        noAvailabilityMessageVisible: false,
        htmlSnippet: ''
      }
    };

    logger.info('--- DEBUG START ---');

    try {
      const mainContent = await page.locator('main, #main-content, .ms-Booking-container').first();
      if (await mainContent.isVisible()) {
        results.debug.htmlSnippet = await mainContent.innerText();
      }
    } catch (e) {}

    const allButtons = await page.locator('button').all();
    results.debug.totalButtons = allButtons.length;

    const daySelectors = [
      'button[aria-label*="available"]',
      'button[aria-label*="disponibile"]',
      '.ms-Calendar-day--isAvailable',
      'button:not([disabled])[aria-label*="202"]'
    ];

    for (const selector of daySelectors) {
      const days = await page.locator(selector).all();
      for (const day of days) {
        const ariaLabel = await day.getAttribute('aria-label');
        const text = await day.innerText();
        const label = ariaLabel || text;
        if (label && !results.dates.includes(label)) results.dates.push(label);
      }
    }

    if (results.dates.length > 0) {
      try {
        const firstDay = page.locator('button[aria-label*="available"], .ms-Calendar-day--isAvailable').first();
        await firstDay.click();
        await page.waitForTimeout(1500);
      } catch (e) {}
    }

    const potentialSlotButtons = await page.locator('button').all();
    for (const button of potentialSlotButtons) {
      const text = (await button.innerText()).trim();
      if (await button.isVisible() && await button.isEnabled() && detection.looksLikeTime(text)) {
        results.slots.push(text);
      }
    }

    const noAvailabilityIndicators = ['text=/no appointments/i', 'text=/no available/i', 'text=/nessun appuntamento/i', 'text=/non ci sono/i', '.ms-MessageBar--error'];
    let indicatorCount = 0;
    for (const sel of noAvailabilityIndicators) {
      if (await page.locator(sel).isVisible()) indicatorCount++;
    }

    if (results.slots.length > 0 || results.dates.length > 0) {
      results.confidence = 'confirmed';
    } else if (indicatorCount === 0 && results.debug.totalButtons > 5) {
      results.confidence = 'possible';
    } else {
      results.confidence = 'none';
    }

    logger.info('--- DEBUG END ---');
    return results;
  }
}

module.exports = new MonitorService();
