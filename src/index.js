require('dotenv').config();
const cron = require('node-cron');
const fs = require('fs');
const { ensureDirs } = require('./config');
const { runPost } = require('./poster');
const logger = require('./logger');
const { loadSchedule, saveSchedule, to12h, SCHEDULE_FILE } = require('./schedule-config');

ensureDirs();

// Create schedule.json with defaults if it doesn't exist yet
if (!fs.existsSync(SCHEDULE_FILE)) {
  saveSchedule(['11:00', '19:00']);
}

let tasks = [];

function parseCron(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return `${m} ${h} * * *`;
}

function registerSchedule() {
  tasks.forEach((t) => t.stop());
  tasks = [];

  const times = loadSchedule();
  times.forEach((timeStr) => {
    const task = cron.schedule(parseCron(timeStr), async () => {
      logger.info(`Scheduled post triggered: ${to12h(timeStr)}`);
      await runPost();
    });
    tasks.push(task);
  });

  logger.info(`Active schedule: ${times.map(to12h).join(', ')}`);
}

registerSchedule();
logger.info('BopperX scheduler running. Press Ctrl+C to stop.');

// Hot-reload cron jobs when schedule.json is saved from the dashboard
fs.watch(SCHEDULE_FILE, () => {
  setTimeout(() => {
    logger.info('schedule.json changed — reloading cron jobs...');
    registerSchedule();
  }, 200);
});
