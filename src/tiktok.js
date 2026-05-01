const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { loadTokens, saveTokens, CLIENT_KEY, CLIENT_SECRET } = require('./config');
const logger = require('./logger');

const BASE_URL = 'https://open.tiktokapis.com/v2';

const MIN_CHUNK = 5  * 1024 * 1024;  // 5 MB
const MAX_CHUNK = 64 * 1024 * 1024;  // 64 MB

async function refreshAccessToken() {
  const tokens = loadTokens();

  if (!CLIENT_KEY || !CLIENT_SECRET) {
    throw new Error(
      'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET are required to refresh the access token.'
    );
  }

  logger.info('Refreshing TikTok access token...');

  const res = await axios.post(
    `${BASE_URL}/oauth/token/`,
    new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const newTokens = {
    access_token: res.data.access_token,
    refresh_token: res.data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (res.data.expires_in || 86400) * 1000,
  };

  saveTokens(newTokens);
  logger.success('Access token refreshed successfully.');
  return newTokens.access_token;
}

async function getAccessToken() {
  const tokens = loadTokens();
  // Refresh 60 seconds before expiry
  if (tokens.expires_at && Date.now() > tokens.expires_at - 60_000) {
    return refreshAccessToken();
  }
  return tokens.access_token;
}

async function initVideoUpload(accessToken, { title, videoSize, chunkSize, totalChunks, privacyLevel }) {
  const res = await axios.post(
    `${BASE_URL}/post/publish/video/init/`,
    {
      post_info: {
        title: title.slice(0, 2200), // TikTok caption limit
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
    }
  );

  const { error, data } = res.data;
  if (!error || error.code !== 'ok') {
    throw new Error(`Upload init failed: ${JSON.stringify(error)}`);
  }

  return data; // { publish_id, upload_url }
}

async function uploadChunks(uploadUrl, videoPath, videoSize, chunkSize, totalChunks) {
  const fd = fs.openSync(videoPath, 'r');

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      // Last chunk absorbs all remaining bytes (can exceed chunkSize, up to 128 MB)
      const end = i === totalChunks - 1 ? videoSize - 1 : start + chunkSize - 1;
      const length = end - start + 1;
      const buffer = Buffer.alloc(length);

      fs.readSync(fd, buffer, 0, length, start);

      await axios.put(uploadUrl, buffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${videoSize}`,
          'Content-Length': length,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      logger.info(`Uploaded chunk ${i + 1}/${totalChunks}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function waitForPublish(accessToken, publishId, maxWaitMs = 120_000) {
  const TERMINAL = new Set(['PUBLISH_COMPLETE', 'FAILED']);
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));

    const res = await axios.post(
      `${BASE_URL}/post/publish/status/fetch/`,
      { publish_id: publishId },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      }
    );

    const { status, fail_reason } = res.data.data || {};
    logger.info(`Publish status: ${status}`);

    if (status === 'PUBLISH_COMPLETE') return { success: true, status };
    if (TERMINAL.has(status)) return { success: false, status, fail_reason };
  }

  return { success: false, status: 'TIMEOUT', fail_reason: 'Timed out waiting for TikTok to process the video.' };
}

async function postVideo(videoPath, caption, privacyLevel) {
  const accessToken = await getAccessToken();
  const videoSize = fs.statSync(videoPath).size;

  // TikTok chunk rules:
  //   chunk_size must be 5–64 MB (or equal to video_size for files under 64 MB)
  //   total_chunk_count = floor(video_size / chunk_size), minimum 1
  //   Last chunk absorbs the remainder and may exceed chunk_size (up to 128 MB)
  let chunkSize, totalChunks;
  if (videoSize <= MAX_CHUNK) {
    chunkSize   = videoSize;
    totalChunks = 1;
  } else {
    chunkSize   = 10 * 1024 * 1024; // 10 MB per chunk
    totalChunks = Math.floor(videoSize / chunkSize);
  }

  const mb = (videoSize / 1024 / 1024).toFixed(1);
  logger.info(`Initializing upload: "${path.basename(videoPath)}" (${mb} MB, ${totalChunks} chunk${totalChunks > 1 ? 's' : ''})`);

  const { publish_id, upload_url } = await initVideoUpload(accessToken, {
    title: caption,
    videoSize,
    chunkSize,
    totalChunks,
    privacyLevel,
  });

  logger.info(`Upload initialized. publish_id: ${publish_id}`);

  await uploadChunks(upload_url, videoPath, videoSize, chunkSize, totalChunks);
  logger.info('All chunks uploaded. Waiting for TikTok to process...');

  const result = await waitForPublish(accessToken, publish_id);
  return { publish_id, ...result };
}

module.exports = { postVideo };
