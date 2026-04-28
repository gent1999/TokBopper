require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { ensureDirs, DIRS } = require('./config');
const { runPost } = require('./poster');
const { loadSchedule, saveSchedule, loadHashtags, saveHashtags, to12h } = require('./schedule-config');
const logger = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const DOCS = path.join(__dirname, '..', 'docs');
app.get('/terms',   (req, res) => res.sendFile(path.join(DOCS, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(DOCS, 'privacy.html')));

ensureDirs();

// ─── helpers ────────────────────────────────────────────────────────────────

function getVideos(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, caption: f.slice(0, -4), size: stat.size, date: stat.mtime.toISOString() };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── API ────────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  res.json({
    ready:    getVideos(DIRS.videos).length,
    posted:   getVideos(DIRS.posted).length,
    failed:   getVideos(DIRS.failed).length,
    schedule: loadSchedule(),
  });
});

const FOLDER_MAP = { ready: DIRS.videos, posted: DIRS.posted, failed: DIRS.failed };

app.get('/api/videos/:folder', (req, res) => {
  const dir = FOLDER_MAP[req.params.folder];
  if (!dir) return res.status(404).json({ error: 'Unknown folder' });
  res.json(getVideos(dir));
});

// Fire and forget — uploading can take minutes; progress appears in logs
app.post('/api/post-now', (req, res) => {
  runPost().catch((err) => logger.error('post-now error', { message: err.message }));
  res.json({ ok: true, message: 'Post started — watch the logs tab for progress.' });
});

app.get('/api/schedule', (req, res) => {
  res.json({ times: loadSchedule(), hashtags: loadHashtags() });
});

app.post('/api/schedule', (req, res) => {
  const { times, hashtags } = req.body;
  if (!Array.isArray(times) || times.length === 0) {
    return res.status(400).json({ error: 'times must be a non-empty array of HH:MM strings' });
  }
  times.sort();
  saveSchedule(times);
  if (Array.isArray(hashtags)) saveHashtags(hashtags);
  res.json({ ok: true, times, hashtags: loadHashtags() });
});

app.get('/api/logs', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const logPath = path.join(DIRS.logs, `${today}.log`);
  if (!fs.existsSync(logPath)) return res.json({ lines: [] });
  const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  res.json({ lines: lines.slice(-150) });
});

// Server-Sent Events — streams new log lines in real time
app.get('/api/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const today = new Date().toISOString().split('T')[0];
  const logPath = path.join(DIRS.logs, `${today}.log`);
  let lastSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;

  const timer = setInterval(() => {
    if (!fs.existsSync(logPath)) return;
    const size = fs.statSync(logPath).size;
    if (size <= lastSize) return;

    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(size - lastSize);
    fs.readSync(fd, buf, 0, buf.length, lastSize);
    fs.closeSync(fd);
    lastSize = size;

    buf.toString('utf-8').trim().split('\n').filter(Boolean).forEach((line) => {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    });
  }, 1000);

  req.on('close', () => clearInterval(timer));
});

app.listen(PORT, () => {
  console.log(`TokBopper dashboard → http://localhost:${PORT}`);
});
