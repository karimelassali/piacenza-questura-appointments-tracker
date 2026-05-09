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
        viewport: { width: 1280, height: 800 },
        locale: 'it-IT',
        timezoneId: config.monitor.timezone || 'Europe/Rome'
      });

      const page = await context.newPage();
      
      await page.goto(config.bookingUrl, { waitUntil: 'networkidle', timeout: 60000 });
      logger.info('Page loaded, waiting for dynamic content...');
      await page.waitForTimeout(5000); 

      const results = await this.performFullCheck(page);
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
      screenshotPaths: [],
      monthsChecked: [],
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
    if (currentMonthResults.monthTitle) availability.monthsChecked.push(currentMonthResults.monthTitle);

    // Take screenshot of current month (AFTER clicking available date if any, so time slots show)
    const screenshot1Path = path.resolve(config.storage.screenshotsDir, `check_${Date.now()}_1.png`);
    await fs.mkdir(config.storage.screenshotsDir, { recursive: true });
    await page.screenshot({ path: screenshot1Path, fullPage: true });
    availability.screenshotPaths.push(screenshot1Path);

    // Try to navigate to next month
    try {
      // The next month button is a div[role="button"] with title="Mese prossimo", NOT a <button>
      const nextButton = page.locator('[title="Mese prossimo"], [aria-label="Mese prossimo"], [aria-label*="Next month" i], [title*="Next month" i]').first();
      
      const nextBtnVisible = await nextButton.isVisible({ timeout: 3000 }).catch(() => false);
      const nextBtnDisabled = nextBtnVisible ? (await nextButton.getAttribute('data-disabled')) === 'true' : true;
      
      if (nextBtnVisible && !nextBtnDisabled) {
        logger.info('Navigating to next month...');
        await nextButton.click();
        await page.waitForTimeout(3000);
        let nextMonthResults = await this.detectAvailability(page);

        // Take screenshot of next month (AFTER clicking available date if any)
        const screenshot2Path = path.resolve(config.storage.screenshotsDir, `check_${Date.now()}_2.png`);
        await page.screenshot({ path: screenshot2Path, fullPage: true });
        availability.screenshotPaths.push(screenshot2Path);

        availability.dates.push(...nextMonthResults.dates);
        availability.slots.push(...nextMonthResults.slots);
        availability.domText += '\n--- NEXT MONTH ---\n' + nextMonthResults.debug.htmlSnippet;
        if (nextMonthResults.monthTitle) availability.monthsChecked.push(nextMonthResults.monthTitle);

        // Upgrade confidence if next month has availability
        if (nextMonthResults.confidence === 'confirmed') {
          availability.confidence = 'confirmed';
        }
      } else {
        logger.info('Next month button not available or disabled.');
      }
    } catch (err) {
      logger.warn('Could not navigate to next month', { error: err.message });
    }

    availability.dates = [...new Set(availability.dates)];
    availability.slots = [...new Set(availability.slots)];
    availability.found = availability.dates.length > 0 || availability.slots.length > 0;
    
    // Set final confidence: use best from either month
    if (availability.found) {
      availability.confidence = 'confirmed';
    } else if (availability.confidence !== 'confirmed') {
      availability.confidence = currentMonthResults.confidence;
    }

    logger.info('Full check complete', {
      found: availability.found,
      dates: availability.dates.length,
      slots: availability.slots.length,
      monthsChecked: availability.monthsChecked,
      confidence: availability.confidence
    });

    return availability;
  }

  async detectAvailability(page) {
    const results = {
      monthTitle: '',
      dates: [],
      slots: [],
      confidence: 'none',
      debug: {
        totalCalendarDays: 0,
        availableDays: 0,
        disabledDays: 0,
        timeSlotsFound: 0,
        htmlSnippet: ''
      }
    };

    logger.info('--- DETECTION START ---');

    // 1. Get page text for AI/debug
    try {
      const mainContent = page.locator('main, #main-content, body').first();
      if (await mainContent.isVisible()) {
        results.debug.htmlSnippet = (await mainContent.innerText()).substring(0, 5000);
      }
    } catch (e) {
      logger.warn('Could not extract page text', { error: e.message });
    }

    // 2. Get month title from the calendar header
    try {
      // The month title is in a div with aria-live="assertive" and a title like "Maggio 2026"
      const monthLabel = page.locator('[aria-live="assertive"][title*="202"], div[title*="Maggio"], div[title*="Giugno"], div[title*="Luglio"], div[title*="Agosto"], div[title*="Settembre"], div[title*="Ottobre"], div[title*="Novembre"], div[title*="Dicembre"], div[title*="Gennaio"], div[title*="Febbraio"], div[title*="Marzo"], div[title*="Aprile"]').first();
      if (await monthLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
        results.monthTitle = (await monthLabel.innerText()).replace(/\n/g, ' ').trim();
        logger.info(`Month detected: ${results.monthTitle}`);
      }
    } catch (e) {
      logger.warn('Could not get month title', { error: e.message });
    }

    // 3. CRITICAL FIX: Calendar days are <div role="button">, NOT <button>!
    //    - Available days: div[role="button"][data-value] WITHOUT aria-disabled="true"
    //    - Unavailable days: div[role="button"][data-value] WITH aria-disabled="true" 
    //      and aria-label contains "Nessun orario disponibile"
    const allCalendarDays = await page.locator('div[role="button"][data-value]').all();
    results.debug.totalCalendarDays = allCalendarDays.length;
    logger.info(`Found ${allCalendarDays.length} calendar day elements`);

    for (const day of allCalendarDays) {
      try {
        const ariaLabel = await day.getAttribute('aria-label') || '';
        const ariaDisabled = await day.getAttribute('aria-disabled');
        const dataValue = await day.getAttribute('data-value') || '';
        const dayText = (await day.innerText()).trim();
        
        const isDisabled = ariaDisabled === 'true';
        const hasNoAvailability = ariaLabel.toLowerCase().includes('nessun orario disponibile');
        
        logger.info(`  Day ${dayText}: aria-label="${ariaLabel}", disabled=${isDisabled}, noAvail=${hasNoAvailability}`);
        
        if (!isDisabled && !hasNoAvailability && dataValue) {
          // This day is AVAILABLE!
          results.dates.push(ariaLabel || `Day ${dayText}`);
          results.debug.availableDays++;
          logger.info(`  ✅ AVAILABLE: ${ariaLabel}`);
        } else {
          results.debug.disabledDays++;
        }
      } catch (e) {
        // skip problematic elements
      }
    }

    logger.info(`Available days: ${results.debug.availableDays}, Disabled days: ${results.debug.disabledDays}`);

    // 4. If we found available dates, CLICK the first one to reveal time slots
    if (results.dates.length > 0) {
      try {
        // Click the first available (non-disabled) calendar day
        const firstAvailableDay = page.locator('div[role="button"][data-value]:not([aria-disabled="true"])').first();
        if (await firstAvailableDay.isVisible({ timeout: 2000 }).catch(() => false)) {
          logger.info('Clicking first available day to reveal time slots...');
          await firstAvailableDay.click();
          await page.waitForTimeout(3000);
          
          // CRITICAL: Time slots in Microsoft Bookings are inside a div[role="group"]
          // container, NOT individual <button> elements!
          // The container has aria-label like "Selezione dell'ora..."
          const timeGroup = page.locator('[role="group"][aria-label*="ora" i], [role="group"][aria-label*="time" i]').first();
          const groupVisible = await timeGroup.isVisible({ timeout: 3000 }).catch(() => false);
          
          if (groupVisible) {
            // Get the full text and split by newlines to extract individual times
            const groupText = await timeGroup.innerText();
            const lines = groupText.split('\n').map(l => l.trim()).filter(Boolean);
            for (const line of lines) {
              if (detection.looksLikeTime(line)) {
                results.slots.push(line);
                logger.info(`  ⏰ TIME SLOT: ${line}`);
              }
            }
          }
          
          // Fallback: also check individual child elements and buttons
          if (results.slots.length === 0) {
            const allInteractive = await page.locator('button, [role="option"], [role="group"] > div').all();
            for (const el of allInteractive) {
              try {
                const text = (await el.innerText()).trim();
                const isVisible = await el.isVisible();
                if (isVisible && detection.looksLikeTime(text)) {
                  results.slots.push(text);
                  logger.info(`  ⏰ TIME SLOT (fallback): ${text}`);
                }
              } catch (e) {}
            }
          }
          
          results.debug.timeSlotsFound = results.slots.length;
          logger.info(`Found ${results.slots.length} time slots`);
        }
      } catch (e) {
        logger.warn('Could not click available day', { error: e.message });
      }
    }

    // 5. Also check for time slots already visible (without clicking)
    if (results.slots.length === 0) {
      try {
        const timeGroup = page.locator('[role="group"][aria-label*="ora" i], [role="group"][aria-label*="time" i]').first();
        if (await timeGroup.isVisible({ timeout: 1000 }).catch(() => false)) {
          const groupText = await timeGroup.innerText();
          const lines = groupText.split('\n').map(l => l.trim()).filter(Boolean);
          for (const line of lines) {
            if (detection.looksLikeTime(line)) {
              results.slots.push(line);
            }
          }
        }
      } catch (e) {}
    }

    // 6. Determine confidence
    if (results.slots.length > 0 || results.dates.length > 0) {
      results.confidence = 'confirmed';
    } else if (results.debug.totalCalendarDays === 0) {
      // Page might not have loaded correctly
      results.confidence = 'possible';
    } else {
      results.confidence = 'none';
    }

    logger.info(`--- DETECTION END --- Confidence: ${results.confidence}, Dates: ${results.dates.length}, Slots: ${results.slots.length}`);
    return results;
  }
}

module.exports = new MonitorService();
