const { execFile, spawn } = require('child_process');
const ffprobeStatic = require('ffprobe-static');
const fs = require('fs');
const path = require('path');
const config = require('./config');

function timeStringToSeconds(timeStr) {
  const parts = timeStr.split(':');
  if (parts.length !== 3) return 0;
  const h = parseFloat(parts[0]);
  const m = parseFloat(parts[1]);
  const s = parseFloat(parts[2]);
  return (h * 3600) + (m * 60) + s;
}

function transcodeToHLS(logger, inputPath, outputDir, videoId, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const finalOutputDir = path.join(outputDir, videoId);

    config.ffmpeg.resolutions.forEach(res => {
      fs.mkdirSync(path.join(finalOutputDir, res.name), { recursive: true });
    });

    const args = [
      '-i', inputPath,
      '-y'
    ];

    let streamMapStr = '';

    config.ffmpeg.resolutions.forEach((res, index) => {
      args.push('-map', '0:v', '-map', '0:a?');
      args.push(`-s:v:${index}`, res.scale, `-b:v:${index}`, res.bitrate);
      streamMapStr += `v:${index},a:${index},name:${res.name} `;
    });

    args.push(
      '-f', 'hls',
      '-hls_time', config.ffmpeg.hlsTime,
      '-hls_playlist_type', 'vod',
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', streamMapStr.trim(),
      '-hls_segment_filename', `${finalOutputDir}/%v/seg%03d.ts`,
      `${finalOutputDir}/%v/index.m3u8`
    );

    logger.info(`FFmpeg args: ffmpeg ${args.join(' ')}`);

    const ffmpegProcess = spawn('ffmpeg', args);
    let lastReportedPercent = 0;

    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);

      if (timeMatch && timeMatch[1] && duration > 0) {
        const currentSeconds = timeStringToSeconds(timeMatch[1]);
        const percent = Math.floor((currentSeconds / duration) * 100);

        if (percent >= lastReportedPercent + 5 && percent <= 100) {
          lastReportedPercent = percent;

          if (onProgress) onProgress(percent);

          logger.info(`[Transcode Progress] ${videoId}: ${percent}%`);
        }
      }
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        logger.info(`Transcoding finished for ${videoId}`);
        if (onProgress) onProgress(100);

        resolve();
      } else {
        logger.error(`FFmpeg process exited with code ${code}`);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpegProcess.on('error', (err) => {
      logger.error(`FFmpeg failed to start: ${err.message}`);
      reject(err);
    });
  });
}

function getVideoDuration(logger, inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath
    ];

    execFile(ffprobeStatic.path, args, (error, stdout, _) => {
      if (error) {
        logger.error(`ffprobe failed: ${error.message}`);
        return reject(error);
      }

      const duration = parseFloat(stdout.trim());

      resolve(duration);
    });
  });
}

async function generateSpriteSheets(logger, inputPath, outputDir, videoId, duration) {
  const finalOutputDir = path.join(outputDir, videoId);
  const spritePattern = path.join(finalOutputDir, 'sprite_%03d.jpg');

  const args = [
    '-y',
    '-i', inputPath,
    '-vf', 'fps=1/10,scale=160:-1,tile=5x5',
    spritePattern
  ];

  logger.info(`Extracting sprite sheets: ffmpeg ${args.join(' ')}`);

  await new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (error, _, stderr) => {
      if (error) {
        logger.error(`Failed to extract sprite sheets: ${stderr}`);
        return reject(error);
      }

      resolve();
    });
  });

  generateVTT(logger, finalOutputDir, duration);
}

function formatVTTTime(seconds) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function generateVTT(logger, outputDir, duration) {
  let vttContent = 'WEBVTT\n\n';
  const vttFilePath = path.join(outputDir, 'thumbnails.vtt');

  const step = 10;
  const cols = 5;
  const rows = 5;
  const thumbWidth = 160;
  const thumbHeight = 90;

  let currentTime = 0;
  let spriteIndex = 1;
  let col = 0;
  let row = 0;

  while (currentTime < duration) {
    const nextTime = Math.min(currentTime + step, duration);

    const startStr = formatVTTTime(currentTime);
    const endStr = formatVTTTime(nextTime);

    const x = col * thumbWidth;
    const y = row * thumbHeight;
    const spriteName = `sprite_${String(spriteIndex).padStart(3, '0')}.jpg`;

    vttContent += `${startStr} --> ${endStr}\n`;
    vttContent += `${spriteName}#xywh=${x},${y},${thumbWidth},${thumbHeight}\n\n`;

    currentTime += step;

    col++;
    if (col >= cols) {
      col = 0;
      row++;
      if (row >= rows) {
        row = 0;
        spriteIndex++;
      }
    }
  }

  fs.writeFileSync(vttFilePath, vttContent);
  logger.info(`Generated thumbnails.vtt spanning ${duration.toFixed(1)}s`);
}

module.exports = {
  transcodeToHLS,
  getVideoDuration,
  generateSpriteSheets
};
