const config = require('./src/config');
const logger = require('./src/utils/logger');
const stateManager = require('./src/storage/state');
const monitorService = require('./src/services/monitor');
const telegramService = require('./src/services/telegram');
const aiVerifier = require('./src/ai/verifier');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendScreenshots(screenshotPaths, message) {
  if (!screenshotPaths || screenshotPaths.length === 0) return;
  if (screenshotPaths.length > 1) {
    await telegramService.sendMediaGroup(screenshotPaths, message);
  } else {
    await telegramService.sendPhoto(screenshotPaths[0], message);
  }
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
    if (config.ai.enabled && availability.screenshotPaths?.length > 0) {
      aiResult = await aiVerifier.verify(availability.screenshotPaths[0], {
        text: availability.domText,
        dates: availability.dates,
        slots: availability.slots
      });
    }

    const isTestMode = process.argv.includes('--test-found') || process.env.SIMULATE_FOUND === 'true';

    // Determine final status based on AI or Fallback
    const status = isTestMode ? 'confirmed' : (aiResult ? aiResult.status : availability.confidence);
    const finalFound = isTestMode ? true : (aiResult ? (aiResult.status === 'confirmed') : (availability.confidence === 'confirmed'));

    if (isTestMode) {
      availability.dates = ['محاكاة - Simulation Date'];
      availability.slots = ['09:00', '10:00', '11:00'];
      logger.info('Running in TEST FOUND mode. Simulating an appointment...');
    }

    if (aiResult && aiResult.siteChanged) {
      logger.warn('AI detected site structure change!');
      await telegramService.sendMessage(telegramService.formatSiteChangedMessage());
    }

    if (status === 'confirmed' || finalFound) {
      if (stateManager.shouldNotify(availability)) {
        logger.info('Confirmed availability! Sending notification...');
        const message = telegramService.formatAlertMessage(availability, aiResult);
        await sendScreenshots(availability.screenshotPaths, message);
        await stateManager.updateState(availability);
      } else {
        logger.info('Availability unchanged. Skipping alert.');
      }
    } else if (status === 'possible' || availability.confidence === 'possible') {
      logger.info('Possible availability! Sending warning...');
      if (stateManager.state.lastAvailabilityHash !== 'possible') {
        const message = telegramService.formatPossibleAvailabilityMessage(availability, aiResult);
        await sendScreenshots(availability.screenshotPaths, message);
        stateManager.state.lastAvailabilityHash = 'possible';
        await stateManager.save();
      }
    } else {
      logger.info('No availability found.');
      const message = telegramService.formatNoAvailabilityMessage(availability, aiResult);
      
      const lastNotification = stateManager.state.lastNotificationTimestamp ? new Date(stateManager.state.lastNotificationTimestamp) : new Date(0);
      const hoursSinceLastNotification = (new Date() - lastNotification) / (1000 * 60 * 60);
      const shouldSendKeepAlive = hoursSinceLastNotification >= 4.5; // ~5 times a day

      if (stateManager.state.lastAvailabilityHash !== 'empty' || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || shouldSendKeepAlive) {
        if (shouldSendKeepAlive) logger.info('Sending keep-alive negative message (4.5 hours passed).');
        await sendScreenshots(availability.screenshotPaths, message);
        await stateManager.updateState({ found: false, dates: [], slots: [] });
        stateManager.state.lastAvailabilityHash = 'empty';
        await stateManager.save();
      }
    }

    if (aiResult && aiResult.status === 'fallback') {
      await telegramService.sendMessage(telegramService.formatAIUnavailableMessage(aiResult.reason));
    }

    logger.info('Monitor run completed successfully.');
  } catch (error) {
    logger.error('CRITICAL: Main process failed', { error: error.message });
    process.exit(1);
  }
}

main();
