const fs = require('fs');
const path = require('path');
const { DIRS, PRIVACY_LEVEL } = require('./config');
const { postVideo } = require('./tiktok');
const { loadHashtags } = require('./schedule-config');
const logger = require('./logger');

function getNextVideo() {
  const files = fs
    .readdirSync(DIRS.videos)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .sort(); // alphabetical — first file wins

  return files.length > 0 ? path.join(DIRS.videos, files[0]) : null;
}

function moveVideo(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  fs.renameSync(src, dest);
  return dest;
}

async function runPost() {
  const videoPath = getNextVideo();

  if (!videoPath) {
    logger.warn('No .mp4 files found in /videos. Add videos to the queue and try again.');
    return;
  }

  const filename = path.basename(videoPath);
  const title = path.basename(videoPath, '.mp4');
  const hashtags = loadHashtags();
  const caption = hashtags.length
    ? `${title}\n${hashtags.map((h) => `#${h}`).join(' ')}`
    : title;

  logger.info(`Posting: ${filename}`);
  logger.info(`Caption: "${caption}"`);

  try {
    const result = await postVideo(videoPath, caption, PRIVACY_LEVEL);

    if (result.success) {
      moveVideo(videoPath, DIRS.posted);
      logger.success(`Successfully posted: "${caption}"`, { publish_id: result.publish_id });
    } else {
      moveVideo(videoPath, DIRS.failed);
      logger.error(`Post failed: "${caption}"`, {
        publish_id: result.publish_id,
        status: result.status,
        reason: result.fail_reason,
      });
    }
  } catch (err) {
    moveVideo(videoPath, DIRS.failed);
    logger.error(`Unexpected error posting: "${caption}"`, {
      message: err.message,
      response: err.response?.data ?? null,
    });
  }
}

module.exports = { runPost };
