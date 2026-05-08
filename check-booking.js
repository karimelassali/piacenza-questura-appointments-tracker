const config = require('./src/config');
const logger = require('./src/utils/logger');
const stateManager = require('./src/storage/state');
const monitorService = require('./src/services/monitor');
const telegramService = require('./src/services/telegram');
const aiVerifier = require('./src/ai/verifier');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runMonitorWithRetries(maxRetries = 3) {
  let attempt = 1;
  while (attempt <= maxRetries) {
    try {
      return await monitorService.run();
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
    await stateManager.init();
    const availability = await runMonitorWithRetries();
    
    let aiResult = null;
    if (config.ai.enabled && availability.screenshotPath) {
      aiResult = await aiVerifier.verify(availability.screenshotPath, {
        text: availability.domText,
        dates: availability.dates,
        slots: availability.slots
      });
    }

    // Determine final status based on AI or Fallback
    const status = aiResult ? aiResult.status : availability.confidence;
    const finalFound = aiResult ? (aiResult.status === 'confirmed') : (availability.confidence === 'confirmed');

    if (aiResult && aiResult.siteChanged) {
      logger.warn('AI detected site structure change!');
      await telegramService.sendMessage(telegramService.formatSiteChangedMessage());
    }

    if (status === 'confirmed' || finalFound) {
      if (stateManager.shouldNotify(availability)) {
        logger.info('Confirmed availability! Sending notification...');
        const message = telegramService.formatAlertMessage(availability, aiResult);
        await telegramService.sendPhoto(availability.screenshotPath, message);
        await stateManager.updateState(availability);
      } else {
        logger.info('Availability unchanged. Skipping alert.');
      }
    } else if (status === 'possible' || availability.confidence === 'possible') {
      logger.info('Possible availability! Sending warning...');
      if (stateManager.state.lastAvailabilityHash !== 'possible') {
        const message = telegramService.formatPossibleAvailabilityMessage(aiResult);
        await telegramService.sendPhoto(availability.screenshotPath, message);
        stateManager.state.lastAvailabilityHash = 'possible';
        await stateManager.save();
      }
    } else {
      logger.info('No availability found.');
      const message = telegramService.formatNoAvailabilityMessage(aiResult);
      if (stateManager.state.lastAvailabilityHash !== 'empty' || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
        await telegramService.sendPhoto(availability.screenshotPath, message);
        await stateManager.updateState({ found: false, dates: [], slots: [] });
        stateManager.state.lastAvailabilityHash = 'empty';
        await stateManager.save();
      }
    }

    if (aiResult && aiResult.status === 'fallback') {
      await telegramService.sendMessage(telegramService.formatAIUnavailableMessage());
    }

    logger.info('Monitor run completed successfully.');
  } catch (error) {
    logger.error('CRITICAL: Main process failed', { error: error.message });
    process.exit(1);
  }
}

main();
