require('dotenv').config();
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

const DIRS = {
  videos: path.join(ROOT, 'videos'),
  posted: path.join(ROOT, 'posted'),
  failed: path.join(ROOT, 'failed'),
  logs: path.join(ROOT, 'logs'),
};

function ensureDirs() {
  for (const dir of Object.values(DIRS)) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

const TOKENS_FILE = path.join(ROOT, 'tokens.json');

function loadTokens() {
  if (fs.existsSync(TOKENS_FILE)) {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
  }
  const tokens = {
    access_token: process.env.TIKTOK_ACCESS_TOKEN,
    refresh_token: process.env.TIKTOK_REFRESH_TOKEN,
  };
  if (!tokens.access_token) {
    throw new Error(
      'No access token found. Set TIKTOK_ACCESS_TOKEN in .env or run the OAuth flow first.'
    );
  }
  return tokens;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

module.exports = {
  DIRS,
  ensureDirs,
  TOKENS_FILE,
  loadTokens,
  saveTokens,
  CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY,
  CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET,
  PRIVACY_LEVEL: process.env.TIKTOK_PRIVACY_LEVEL || 'PUBLIC_TO_EVERYONE',
};
