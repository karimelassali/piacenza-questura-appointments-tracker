const { chromium } = require('playwright');
const config = require('./src/config');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(config.bookingUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  
  // Navigate to next month
  const nextBtn = page.locator('[title="Mese prossimo"]').first();
  const visible = await nextBtn.isVisible().catch(() => false);
  const disabled = visible ? (await nextBtn.getAttribute('data-disabled')) === 'true' : true;
  
  if (visible && !disabled) {
    console.log('Clicking next month...');
    await nextBtn.click();
    await page.waitForTimeout(3000);
  }
  
  // Find and click available day
  const availDay = page.locator('div[role="button"][data-value]:not([aria-disabled="true"])').first();
  const dayVisible = await availDay.isVisible().catch(() => false);
  
  if (dayVisible) {
    const dayLabel = await availDay.getAttribute('aria-label');
    console.log('Found available day:', dayLabel);
    await availDay.click();
    await page.waitForTimeout(3000);
    
    // Get ALL elements and check what contains time-like text
    const allElements = await page.locator('button, [role="button"], [role="option"], div[tabindex]').all();
    console.log('\nTotal interactive elements:', allElements.length);
    
    for (let i = 0; i < allElements.length; i++) {
      try {
        const text = (await allElements[i].innerText()).trim();
        const isVis = await allElements[i].isVisible();
        if (!isVis || !text) continue;
        
        // Check if it looks like a time (H:MM or HH:MM)
        if (/^\d{1,2}:\d{2}/.test(text)) {
          const tag = await allElements[i].evaluate(el => el.tagName);
          const cls = await allElements[i].getAttribute('class') || '';
          const role = await allElements[i].getAttribute('role') || '';
          const aria = await allElements[i].getAttribute('aria-label') || '';
          console.log(`  TIME FOUND: "${text}" | tag=${tag} role=${role} class=${cls.substring(0,40)} aria="${aria}"`);
        }
      } catch (e) {}
    }

    // Also try getting the raw HTML of the time section
    try {
      const oraSection = await page.evaluate(() => {
        const allText = document.body.innerText;
        const oraIndex = allText.indexOf('ORA');
        if (oraIndex > -1) {
          return allText.substring(oraIndex, oraIndex + 500);
        }
        return 'ORA section not found';
      });
      console.log('\n--- ORA Section Text ---');
      console.log(oraSection);
    } catch (e) {
      console.log('Could not get ORA section');
    }
    
  } else {
    console.log('No available day found right now');
  }
  
  await browser.close();
})();
