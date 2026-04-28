/* ── state ── */
const state = {
  tab:           'ready',
  status:        { ready: 0, posted: 0, failed: 0, schedule: [] },
  videos:        {},   // keyed by folder name
  schedule:      [],   // current saved times
  hashtagDraft:  [],   // working hashtag list while editing
  logSSE:        null, // active EventSource
};

/* ── formatting ── */
function fmtBytes(b) {
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function to12h(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr}:${m.toString().padStart(2, '0')} ${period}`;
}

// Accepts "11:00 AM", "7:00 PM", "14:00", "9:00" — returns "HH:MM" or null
function parseTime(str) {
  str = str.trim().toUpperCase();

  const m12 = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const m = parseInt(m12[2], 10);
    if (m12[3] === 'AM' && h === 12) h = 0;
    if (m12[3] === 'PM' && h !== 12) h += 12;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  const m24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const m = parseInt(m24[2], 10);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return null;
}

/* ── API helpers ── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

/* ── toast ── */
let toastTimer = null;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 4000);
}

/* ── status bar ── */
async function refreshStatus() {
  const s = await api('GET', '/api/status');
  state.status = s;
  state.schedule = s.schedule;

  document.getElementById('pill-ready').textContent    = `ready: ${s.ready}`;
  document.getElementById('pill-posted').textContent   = `posted: ${s.posted}`;
  document.getElementById('pill-failed').textContent   = `failed: ${s.failed}`;
  document.getElementById('pill-schedule').textContent =
    'schedule: ' + (s.schedule.length ? s.schedule.map(to12h).join(' | ') : 'none');
}

/* ── render helpers ── */
function prompt(cmd) {
  return `<div class="section-title"><span class="prompt">$</span> <span>${cmd}</span></div>`;
}

function videoTable(videos, folder) {
  if (!videos.length) {
    const msgs = { ready: 'No videos queued. Drop .mp4 files into /videos.', posted: 'Nothing posted yet.', failed: 'No failures.' };
    return `<div class="empty-msg">${msgs[folder] || 'Empty.'}</div>`;
  }

  const rows = videos.map((v, i) => `
    <tr>
      <td class="col-num">${i + 1}</td>
      <td class="col-caption">${esc(v.caption)}</td>
      <td class="col-size">${fmtBytes(v.size)}</td>
      <td class="col-date">${fmtDate(v.date)}</td>
    </tr>`).join('');

  return `
    <table class="video-table">
      <thead><tr>
        <th>#</th><th>caption</th><th>size</th><th>date</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── tabs ── */
async function renderReady() {
  const videos = await api('GET', '/api/videos/ready');
  state.videos.ready = videos;
  const next = videos[0];

  let html = prompt('ls videos/');
  html += videoTable(videos, 'ready');

  if (next) {
    html += `<div class="next-label">next to post → <span>"${esc(next.caption)}"</span></div>`;
    html += `<button class="btn" id="btn-post">post-now</button>`;
  }

  document.getElementById('content').innerHTML = html;

  if (next) {
    document.getElementById('btn-post').addEventListener('click', postNow);
  }
}

async function renderPosted() {
  const videos = await api('GET', '/api/videos/posted');
  document.getElementById('content').innerHTML =
    prompt('ls posted/') + videoTable(videos, 'posted');
}

async function renderFailed() {
  const videos = await api('GET', '/api/videos/failed');
  document.getElementById('content').innerHTML =
    prompt('ls failed/') + videoTable(videos, 'failed');
}

async function renderSchedule() {
  const data = await api('GET', '/api/schedule');
  state.schedule     = data.times    || [];
  state.hashtagDraft = [...(data.hashtags || [])];

  const [t1 = '', t2 = ''] = state.schedule.map(to12h);

  document.getElementById('content').innerHTML = `
    ${prompt('nano schedule.json')}
    <div class="schedule-hint">accepts 12-hour (11:00 AM) or 24-hour (14:00)</div>
    <div class="time-inputs">
      <div class="time-field">
        <label class="time-label">post time 1</label>
        <input class="time-input" id="time1" type="text" value="${esc(t1)}" placeholder="e.g. 11:00 AM" spellcheck="false" autocomplete="off" />
      </div>
      <div class="time-field">
        <label class="time-label">post time 2</label>
        <input class="time-input" id="time2" type="text" value="${esc(t2)}" placeholder="e.g. 7:00 PM" spellcheck="false" autocomplete="off" />
      </div>
    </div>

    <div class="hashtag-section">
      <div class="time-label" style="margin-bottom:10px">hashtags <span class="hashtag-count">(${state.hashtagDraft.length}/4)</span></div>
      <div id="hashtag-list"></div>
      <button class="btn-add-tag" id="btn-add-tag">+ add hashtag</button>
    </div>

    <button class="btn" id="btn-save">save-schedule</button>
  `;

  renderHashtagList();

  document.getElementById('btn-add-tag').addEventListener('click', () => {
    if (state.hashtagDraft.length < 4) {
      state.hashtagDraft.push('');
      renderHashtagList();
      const inputs = document.querySelectorAll('.hashtag-input');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }
  });

  document.getElementById('btn-save').addEventListener('click', saveSchedule);
}

function renderHashtagList() {
  const list = document.getElementById('hashtag-list');
  if (!list) return;

  list.innerHTML = state.hashtagDraft.map((tag, i) => `
    <div class="hashtag-row">
      <span class="hashtag-prefix">#</span>
      <input
        class="hashtag-input"
        type="text"
        value="${esc(tag)}"
        placeholder="hashtag"
        maxlength="30"
        spellcheck="false"
        autocomplete="off"
        data-idx="${i}"
      />
      <button class="hashtag-remove" data-idx="${i}" title="remove">×</button>
    </div>
  `).join('');

  // Update count label
  const countEl = document.querySelector('.hashtag-count');
  if (countEl) countEl.textContent = `(${state.hashtagDraft.length}/4)`;

  // Show/hide add button based on limit
  const addBtn = document.getElementById('btn-add-tag');
  if (addBtn) addBtn.style.display = state.hashtagDraft.length >= 4 ? 'none' : '';

  list.querySelectorAll('.hashtag-input').forEach((input) => {
    input.addEventListener('input', () => {
      // strip #, spaces, special chars as they type
      const clean = input.value.replace(/^#+/, '').replace(/\s/g, '');
      if (clean !== input.value) { input.value = clean; }
      state.hashtagDraft[parseInt(input.dataset.idx)] = clean;
    });
  });

  list.querySelectorAll('.hashtag-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.hashtagDraft.splice(parseInt(btn.dataset.idx), 1);
      renderHashtagList();
    });
  });
}

async function renderLogs() {
  document.getElementById('content').innerHTML = `
    ${prompt('tail -f logs/today.log')}
    <div id="log-output"><span class="log-empty">loading...</span></div>
  `;

  const { lines } = await api('GET', '/api/logs');
  const out = document.getElementById('log-output');

  if (!lines.length) {
    out.innerHTML = '<span class="log-empty">No log entries yet today.</span>';
  } else {
    out.innerHTML = lines.map(logLine).join('');
    out.scrollTop = out.scrollHeight;
  }

  // SSE: stream new lines in real time
  if (state.logSSE) state.logSSE.close();
  const src = new EventSource('/api/logs/stream');
  state.logSSE = src;

  src.onmessage = (e) => {
    const line = JSON.parse(e.data);
    const empty = out.querySelector('.log-empty');
    if (empty) empty.remove();
    out.innerHTML += logLine(line);
    out.scrollTop = out.scrollHeight;
  };
}

function logLine(line) {
  let cls = 'info';
  if (line.includes('[SUCCESS]')) cls = 'success';
  else if (line.includes('[ERROR]')) cls = 'error';
  else if (line.includes('[WARN]'))  cls = 'warn';
  return `<div class="log-line ${cls}">${esc(line)}</div>`;
}

/* ── actions ── */
async function postNow() {
  const btn = document.getElementById('btn-post');
  btn.disabled = true;
  btn.textContent = 'posting...';

  try {
    const res = await api('POST', '/api/post-now');
    toast(res.message || 'Post started.', 'ok');
    await refreshStatus();
    await renderReady();
  } catch {
    toast('Request failed. Is the server running?', 'err');
    btn.disabled = false;
    btn.textContent = 'post-now';
  }
}

async function saveSchedule() {
  const raw = [
    document.getElementById('time1').value,
    document.getElementById('time2').value,
  ].filter((v) => v.trim());

  if (!raw.length) {
    toast('Enter at least one time.', 'err');
    return;
  }

  const times = raw.map(parseTime);
  const badIdx = times.indexOf(null);
  if (badIdx !== -1) {
    toast(`Invalid time: "${raw[badIdx]}" — use 11:00 AM or 14:00`, 'err');
    return;
  }

  // Collect hashtags from inputs (trim, dedupe, drop empties)
  const hashtags = [...new Set(
    state.hashtagDraft.map((h) => h.trim().replace(/^#+/, '')).filter(Boolean)
  )].slice(0, 4);

  times.sort();
  const res = await api('POST', '/api/schedule', { times, hashtags });
  if (res.ok) {
    state.schedule     = res.times;
    state.hashtagDraft = res.hashtags;
    await refreshStatus();
    const tagStr = hashtags.length ? '  tags: ' + hashtags.map((h) => '#' + h).join(' ') : '';
    toast('Saved: ' + res.times.map(to12h).join(' | ') + tagStr, 'ok');
    renderSchedule();
  } else {
    toast(res.error || 'Save failed.', 'err');
  }
}

/* ── tab switching ── */
function switchTab(tab) {
  if (state.logSSE && tab !== 'logs') {
    state.logSSE.close();
    state.logSSE = null;
  }

  state.tab = tab;

  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  document.getElementById('content').innerHTML = '<div class="spinner">loading...</div>';

  switch (tab) {
    case 'ready':    renderReady();    break;
    case 'posted':   renderPosted();   break;
    case 'failed':   renderFailed();   break;
    case 'schedule': renderSchedule(); break;
    case 'logs':     renderLogs();     break;
  }
}

/* ── login screen ── */
function showLoginScreen(authResult) {
  document.getElementById('app').classList.add('login-mode');

  let errorMsg = '';
  if (authResult && authResult !== 'ok') {
    errorMsg = `<div class="login-error">Authorization failed (${authResult}). Please try again.</div>`;
  }

  document.getElementById('content').innerHTML = `
    <div class="login-screen">
      <img src="/logo.png" alt="TokBopper" class="login-logo" />
      <div class="login-title">TokBopper<span class="cursor">█</span></div>
      <p class="login-desc">Connect your TikTok account to start scheduling posts.</p>
      ${errorMsg}
      <a href="/auth/login" class="btn login-btn">login with TikTok</a>
    </div>
  `;
}

/* ── boot ── */
async function init() {
  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  document.body.appendChild(toastEl);

  const params = new URLSearchParams(window.location.search);
  const authResult = params.get('auth');
  if (authResult) history.replaceState({}, '', '/');

  const { authenticated } = await api('GET', '/api/auth/status');

  if (!authenticated) {
    showLoginScreen(authResult);
    return;
  }

  // Tab clicks
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Append logout to footer
  const footer = document.getElementById('footer');
  if (footer) {
    footer.innerHTML += '<span class="footer-sep">·</span><a href="/auth/logout">logout</a>';
  }

  if (authResult === 'ok') toast('TikTok account connected!', 'ok');

  await refreshStatus();
  switchTab('ready');
  setInterval(refreshStatus, 30_000);
}

document.addEventListener('DOMContentLoaded', init);
