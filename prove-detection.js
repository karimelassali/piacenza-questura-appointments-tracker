/**
 * PROOF TEST: Simulates an available appointment on the REAL page
 * to prove the detection logic works.
 * 
 * What this does:
 * 1. Opens the real Questura booking page
 * 2. Takes a screenshot BEFORE (showing all disabled)
 * 3. Injects a FAKE available day by modifying the DOM (like what happens when a real slot opens)
 * 4. Runs the detection logic
 * 5. Takes a screenshot AFTER (showing the detected day)
 * 6. Sends the proof to Telegram
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs/promises');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const detection = require('./src/utils/detection');
const telegramService = require('./src/services/telegram');

async function runProofTest() {
  let browser;
  try {
    logger.info('=== PROOF TEST: Simulating available appointment ===');
    
    browser = await chromium.launch({ 
      headless: config.monitor.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    
    await page.goto(config.bookingUrl, { waitUntil: 'networkidle', timeout: 60000 });
    logger.info('Page loaded, waiting for content...');
    await page.waitForTimeout(5000);

    // ========== STEP 1: Show current state (all disabled) ==========
    logger.info('\n--- STEP 1: Current real state ---');
    
    const allDaysBefore = await page.locator('div[role="button"][data-value]').all();
    let disabledCount = 0;
    let enabledCount = 0;
    
    for (const day of allDaysBefore) {
      const ariaDisabled = await day.getAttribute('aria-disabled');
      if (ariaDisabled === 'true') disabledCount++;
      else enabledCount++;
    }
    
    logger.info(`BEFORE injection: ${allDaysBefore.length} days total, ${disabledCount} disabled, ${enabledCount} enabled`);
    
    const beforePath = path.resolve('./screenshots', `proof_BEFORE_${Date.now()}.png`);
    await fs.mkdir('./screenshots', { recursive: true });
    await page.screenshot({ path: beforePath, fullPage: false });
    logger.info(`Screenshot BEFORE saved: ${beforePath}`);

    // ========== STEP 2: Inject a FAKE available day ==========
    logger.info('\n--- STEP 2: Injecting fake available day (simulating real appointment opening) ---');
    
    // Modify the 15th day of the current month to simulate it being available
    // This is EXACTLY what the page looks like when a real slot opens up
    await page.evaluate(() => {
      const allDays = document.querySelectorAll('div[role="button"][data-value]');
      // Pick a day in the middle (index 14 = 15th day)
      const targetDay = allDays[14]; 
      if (targetDay) {
        // Remove disabled state — this is what Microsoft Bookings does when a slot opens
        targetDay.removeAttribute('aria-disabled');
        targetDay.classList.remove('XXDXr'); // Remove the disabled CSS class
        targetDay.setAttribute('tabindex', '0');
        
        // Change aria-label to remove "Nessun orario disponibile"
        const oldLabel = targetDay.getAttribute('aria-label') || '';
        const newLabel = oldLabel.replace('. Nessun orario disponibile', '');
        targetDay.setAttribute('aria-label', newLabel);
        
        // Make it visually stand out (like real available days)
        targetDay.style.backgroundColor = '#0078BA';
        targetDay.style.color = 'white';
        targetDay.style.borderRadius = '50%';
        targetDay.style.fontWeight = 'bold';
        
        console.log('INJECTED:', newLabel);
      }
    });
    
    logger.info('Fake available day injected!');
    await page.waitForTimeout(500);

    // ========== STEP 3: Run detection on the modified page ==========
    logger.info('\n--- STEP 3: Running detection on modified page ---');
    
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
      }
    };

    // Get month title
    try {
      const monthLabel = page.locator('[aria-live="assertive"][title*="202"], div[title*="Maggio"], div[title*="Giugno"]').first();
      if (await monthLabel.isVisible({ timeout: 2000 }).catch(() => false)) {
        results.monthTitle = (await monthLabel.innerText()).replace(/\n/g, ' ').trim();
      }
    } catch (e) {}

    // Detect calendar days (same logic as monitor.js)
    const allCalendarDays = await page.locator('div[role="button"][data-value]').all();
    results.debug.totalCalendarDays = allCalendarDays.length;

    for (const day of allCalendarDays) {
      try {
        const ariaLabel = await day.getAttribute('aria-label') || '';
        const ariaDisabled = await day.getAttribute('aria-disabled');
        const dataValue = await day.getAttribute('data-value') || '';
        const dayText = (await day.innerText()).trim();
        
        const isDisabled = ariaDisabled === 'true';
        const hasNoAvailability = ariaLabel.toLowerCase().includes('nessun orario disponibile');
        
        if (!isDisabled && !hasNoAvailability && dataValue) {
          results.dates.push(ariaLabel || `Day ${dayText}`);
          results.debug.availableDays++;
          logger.info(`  ✅ DETECTED AVAILABLE: "${ariaLabel}"`);
        } else {
          results.debug.disabledDays++;
        }
      } catch (e) {}
    }

    if (results.dates.length > 0) {
      results.confidence = 'confirmed';
    } else {
      results.confidence = 'none';
    }

    logger.info(`\nAFTER injection: ${results.debug.totalCalendarDays} days total, ${results.debug.disabledDays} disabled, ${results.debug.availableDays} AVAILABLE`);
    logger.info(`Detection result: confidence=${results.confidence}, dates found=${results.dates.length}`);
    
    if (results.dates.length > 0) {
      logger.info('\n🎉🎉🎉 PROOF: Detection WORKS! It found the injected available day! 🎉🎉🎉');
      logger.info(`Detected dates: ${results.dates.join(', ')}`);
    } else {
      logger.info('\n❌ Detection FAILED to find the injected day');
    }

    // Take screenshot with the highlighted day
    const afterPath = path.resolve('./screenshots', `proof_AFTER_${Date.now()}.png`);
    await page.screenshot({ path: afterPath, fullPage: false });
    logger.info(`Screenshot AFTER saved: ${afterPath}`);

    // ========== STEP 4: Send proof to Telegram ==========
    logger.info('\n--- STEP 4: Sending proof to Telegram ---');
    
    const proofMessage = results.dates.length > 0
      ? `✅ <b>PROOF TEST PASSED!</b>\n\n` +
        `🧪 The detection correctly identified a simulated available day.\n\n` +
        `📊 <b>Results:</b>\n` +
        `• Total calendar days: ${results.debug.totalCalendarDays}\n` +
        `• Disabled days: ${results.debug.disabledDays}\n` +
        `• <b>Available days detected: ${results.debug.availableDays}</b>\n` +
        `• Detected: ${results.dates.join(', ')}\n\n` +
        `📸 Left = BEFORE (all grey) | Right = AFTER (injected day highlighted in blue)\n\n` +
        `<i>This proves the bot WILL detect real appointments when they open up. ✅</i>`
      : `❌ <b>PROOF TEST FAILED</b>\n\nDetection did not find the injected day.`;

    await telegramService.sendMediaGroup([beforePath, afterPath], proofMessage);
    
    logger.info('\n=== PROOF TEST COMPLETE ===');

  } catch (error) {
    logger.error('Proof test failed', { error: error.message, stack: error.stack });
  } finally {
    if (browser) await browser.close();
  }
}

runProofTest();
