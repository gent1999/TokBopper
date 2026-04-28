const fs = require('fs');
const path = require('path');

const SCHEDULE_FILE = path.join(__dirname, '..', 'schedule.json');
const DEFAULT_TIMES = ['11:00', '19:00'];

function loadSchedule() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
      if (Array.isArray(data.times) && data.times.length > 0) return data.times;
    }
  } catch {
    // fall through to defaults on any parse error
  }
  return DEFAULT_TIMES;
}

function loadHashtags() {
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8'));
      if (Array.isArray(data.hashtags)) return data.hashtags.slice(0, 4);
    }
  } catch {}
  return [];
}

function saveSchedule(times) {
  // Preserve existing hashtags when only updating times
  let current = {};
  try { if (fs.existsSync(SCHEDULE_FILE)) current = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')); } catch {}
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify({ ...current, times }, null, 2));
}

function saveHashtags(hashtags) {
  let current = {};
  try { if (fs.existsSync(SCHEDULE_FILE)) current = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf-8')); } catch {}
  fs.writeFileSync(SCHEDULE_FILE, JSON.stringify({ ...current, hashtags: hashtags.slice(0, 4) }, null, 2));
}

function to12h(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}

module.exports = { loadSchedule, saveSchedule, loadHashtags, saveHashtags, to12h, SCHEDULE_FILE };
