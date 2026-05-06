const config = require('./src/config');
const logger = require('./src/utils/logger');
const stateManager = require('./src/storage/state');
const monitorService = require('./src/services/monitor');
const telegramService = require('./src/services/telegram');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMonitorWithRetries(maxRetries = 5) {
  let attempt = 1;
  while (attempt <= maxRetries) {
    try {
      const availability = await monitorService.run();
      return availability;
    } catch (error) {
      logger.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) throw error;
      
      const backoff = Math.pow(2, attempt) * 1000;
      logger.info(`Retrying in ${backoff / 1000}s...`);
      await sleep(backoff);
      attempt++;
    }
  }
}

async function main() {
  try {
    // 1. Initialize state
    await stateManager.init();

    // 2. Run monitor
    const availability = await runMonitorWithRetries();

    // 3. Handle results
    if (availability.found || availability.confidence === 'confirmed') {
      if (stateManager.shouldNotify(availability)) {
        logger.info('Confirmed availability detected! Sending notification...');
        const message = telegramService.formatAlertMessage(availability);
        if (availability.screenshotPath) await telegramService.sendPhoto(availability.screenshotPath, message);
        else await telegramService.sendMessage(message);
        await stateManager.updateState(availability);
      } else {
        logger.info('Availability unchanged. Skipping alert.');
      }
    } else if (availability.confidence === 'possible') {
      logger.info('Possible availability detected! Sending warning...');
      const message = telegramService.formatPossibleAvailabilityMessage();
      if (availability.screenshotPath) await telegramService.sendPhoto(availability.screenshotPath, message);
      else await telegramService.sendMessage(message);

      // Update state to avoid spamming the "possible" alert
      if (stateManager.state.lastAvailabilityHash !== 'possible') {
        stateManager.state.lastAvailabilityHash = 'possible';
        await stateManager.save();
      }
    } else {
      logger.info('No availability found (confirmed by indicators). Sending update...');
      const message = telegramService.formatNoAvailabilityMessage();
      if (availability.screenshotPath) await telegramService.sendPhoto(availability.screenshotPath, message);
      else await telegramService.sendMessage(message);

      if (stateManager.state.lastAvailabilityHash !== 'empty') {
        await stateManager.updateState({ found: false, dates: [], slots: [] });
        stateManager.state.lastAvailabilityHash = 'empty';
        await stateManager.save();
      }
    }

    logger.info('Monitor run completed successfully.');
  } catch (error) {
    logger.error('CRITICAL: Main process failed', { error: error.message });
    process.exit(1);
  }
}

main();
