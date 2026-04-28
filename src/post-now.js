require('dotenv').config();
const { ensureDirs } = require('./config');
const { runPost } = require('./poster');
const logger = require('./logger');

(async () => {
  ensureDirs();
  logger.info('Manual post triggered via "npm run post-now".');
  await runPost();
})();
