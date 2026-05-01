require('dotenv').config();
const http = require('http');
const { exec } = require('child_process');
const { URL } = require('url');
const axios = require('axios');
const { saveTokens } = require('./config');

const CLIENT_KEY    = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI  = 'http://localhost:8080/callback';
const PORT          = 8080;

if (!CLIENT_KEY || !CLIENT_SECRET) {
  console.error('\nMissing credentials. Add these to your .env file first:\n');
  console.error('  TIKTOK_CLIENT_KEY=...');
  console.error('  TIKTOK_CLIENT_SECRET=...\n');
  process.exit(1);
}

// Random string to guard against CSRF
const csrfState = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

const authUrl = new URL('https://www.tiktok.com/v2/auth/authorize/');
authUrl.searchParams.set('client_key',     CLIENT_KEY);
authUrl.searchParams.set('scope',          'video.publish');
authUrl.searchParams.set('response_type',  'code');
authUrl.searchParams.set('redirect_uri',   REDIRECT_URI);
authUrl.searchParams.set('state',          csrfState);

console.log('\nOpening TikTok in your browser — approve the permissions and you\'re done.');
console.log('\nIf the browser didn\'t open, paste this URL manually:\n');
console.log('  ' + authUrl.toString() + '\n');

// Open browser cross-platform
const openCmd =
  process.platform === 'win32' ? `start "" "${authUrl}"` :
  process.platform === 'darwin' ? `open "${authUrl}"` :
  `xdg-open "${authUrl}"`;

exec(openCmd);

// Local server to catch the OAuth callback
const server = http.createServer(async (req, res) => {
  let parsed;
  try { parsed = new URL(req.url, `http://localhost:${PORT}`); } catch { return; }

  if (parsed.pathname !== '/callback') { res.end(); return; }

  const code          = parsed.searchParams.get('code');
  const returnedState = parsed.searchParams.get('state');
  const error         = parsed.searchParams.get('error');

  const send = (title, body, color = '#3fb950') => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html><html><body style="font-family:monospace;background:#0d1117;color:${color};padding:48px;max-width:600px">
      <h2>${title}</h2><p>${body}</p></body></html>`);
  };

  if (error) {
    send('Authorization denied', `TikTok returned: ${error}<br><br>You can close this tab.`, '#f85149');
    console.error('\nAuthorization denied by TikTok:', error, '\n');
    server.close();
    process.exit(1);
  }

  if (!code) {
    send('No code received', 'Something went wrong. Try running npm run auth again.', '#f85149');
    server.close();
    process.exit(1);
  }

  if (returnedState !== csrfState) {
    send('State mismatch', 'Possible CSRF — please try again.', '#f85149');
    server.close();
    process.exit(1);
  }

  console.log('Got authorization code. Exchanging for tokens...');

  try {
    const tokenRes = await axios.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key:    CLIENT_KEY,
        client_secret: CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenRes.data;

    if (!access_token) {
      throw new Error('No access_token in response: ' + JSON.stringify(tokenRes.data));
    }

    saveTokens({
      access_token,
      refresh_token,
      expires_at: Date.now() + (expires_in || 86400) * 1000,
    });

    const hours = Math.floor((expires_in || 86400) / 3600);
    console.log('\n  Tokens saved to tokens.json');
    console.log(`  Access token valid for ~${hours} hours (auto-refreshed when needed)`);
    console.log('\n  All set. Run:');
    console.log('    npm start       — start the scheduler');
    console.log('    npm run serve   — open the web dashboard\n');

    send(
      'BopperX authorized!',
      'Tokens saved. You can close this tab and return to your terminal.'
    );
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message;
    console.error('\nToken exchange failed:\n', detail, '\n');
    send('Token exchange failed', `<pre>${detail}</pre>`, '#f85149');
    server.close();
    process.exit(1);
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`Waiting for TikTok callback on port ${PORT}...`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use. Close whatever is running on it and try again.\n`);
  } else {
    console.error('\nServer error:', err.message);
  }
  process.exit(1);
});
