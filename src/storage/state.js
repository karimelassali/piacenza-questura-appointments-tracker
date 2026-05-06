const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

class StateManager {
  constructor() {
    this.filePath = path.resolve(config.storage.stateFilePath);
    this.state = {
      lastAvailabilityHash: null,
      lastNotificationTimestamp: null,
      history: []
    };
  }

  async init() {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.state = JSON.parse(content);
      logger.info('State loaded successfully');
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No existing state file found, starting fresh');
        await this.save();
      } else {
        logger.error('Failed to load state file', { error: error.message });
      }
    }
  }

  async save() {
    try {
      await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2));
    } catch (error) {
      logger.error('Failed to save state file', { error: error.message });
    }
  }

  generateHash(availability) {
    return crypto.createHash('md5').update(JSON.stringify(availability)).digest('hex');
  }

  shouldNotify(availability) {
    const newHash = this.generateHash(availability);
    if (newHash === this.state.lastAvailabilityHash) {
      return false;
    }
    return true;
  }

  async updateState(availability) {
    this.state.lastAvailabilityHash = this.generateHash(availability);
    this.state.lastNotificationTimestamp = new Date().toISOString();
    this.state.history.push({
      timestamp: this.state.lastNotificationTimestamp,
      availability
    });
    
    // Keep history manageable
    if (this.state.history.length > 50) {
      this.state.history.shift();
    }

    await this.save();
  }
}

module.exports = new StateManager();
