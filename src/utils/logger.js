const fs = require('fs');
const path = require('path');

const log = (level, message, data = null) => {
  const timestamp = new Date().toISOString();
  const dataString = data ? ` | Data: ${JSON.stringify(data)}` : '';
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataString}\n`;

  console.log(logMessage.trim());

  // Optionally write to a log file if needed
  // fs.appendFileSync(path.join(__dirname, '../../app.log'), logMessage);
};

const logger = {
  info: (msg, data) => log('info', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  error: (msg, data) => log('error', msg, data),
  debug: (msg, data) => {
    if (process.env.DEBUG === 'true') log('debug', msg, data);
  },
};

module.exports = logger;
