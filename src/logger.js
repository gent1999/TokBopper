const fs = require('fs');
const path = require('path');
const { DIRS } = require('./config');

const COLORS = {
  INFO: '\x1b[36m',
  SUCCESS: '\x1b[32m',
  ERROR: '\x1b[31m',
  WARN: '\x1b[33m',
  RESET: '\x1b[0m',
};

function log(level, message, meta = null) {
  const timestamp = new Date().toISOString();
  const date = timestamp.split('T')[0];
  const logPath = path.join(DIRS.logs, `${date}.log`);

  let line = `[${timestamp}] [${level}] ${message}`;
  if (meta) line += `\n${JSON.stringify(meta, null, 2)}`;
  line += '\n';

  const color = COLORS[level] || '';
  process.stdout.write(`${color}${line.trim()}${COLORS.RESET}\n`);

  try {
    fs.appendFileSync(logPath, line);
  } catch {
    // logs dir may not exist yet during first init — skip silently
  }
}

module.exports = {
  info: (msg, meta) => log('INFO', msg, meta),
  success: (msg, meta) => log('SUCCESS', msg, meta),
  error: (msg, meta) => log('ERROR', msg, meta),
  warn: (msg, meta) => log('WARN', msg, meta),
};
