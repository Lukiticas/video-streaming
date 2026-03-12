const { Client } = require('minio');
const fs = require('fs');
const path = require('path');

const BUCKET_UPLOADS = 'uploads';
const BUCKET_PROCESSED = 'processed';

const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin'
});

async function downloadChunks(logger, videoId, chunksCount, workDir) {
  const combinedFilePath = path.join(workDir, 'input.mp4');
  const writeStream = fs.createWriteStream(combinedFilePath);

  logger.info(`Downloading ${chunksCount} chunks for ${videoId}...`);

  for (let i = 1; i <= chunksCount; i++) {
    const chunkKey = `${videoId}/chunk_${String(i).padStart(3, '0')}.part`;
    const dataStream = await minioClient.getObject(BUCKET_UPLOADS, chunkKey);

    await new Promise((resolve, reject) => {
      dataStream.pipe(writeStream, { end: false });
      dataStream.on('end', resolve);
      dataStream.on('error', reject);
    });

    logger.info(`Downloaded chunk ${i}/${chunksCount}`);
  }

  writeStream.end();
  return combinedFilePath;
}

async function uploadFolderToMinio(logger, dirPath, videoId) {
  const files = fs.readdirSync(dirPath, { recursive: true });
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isFile()) {
      const objectName = path.posix.join(videoId, file.split(path.sep).join(path.posix.sep));
      await minioClient.fPutObject(BUCKET_PROCESSED, objectName, fullPath);
      logger.info(`Uploaded ${objectName} to MinIO`);
    }
  }
}

async function cleanUploadChunks(logger, videoId, chunksCount) {
  logger.info(`Cleaning up temporary MinIO upload chunks for ${videoId}...`);
  try {
    const objectsList = [];
    for (let i = 1; i <= chunksCount; i++) {
      objectsList.push(`${videoId}/chunk_${String(i).padStart(3, '0')}.part`);
    }

    await minioClient.removeObjects(BUCKET_UPLOADS, objectsList);
    logger.info(`Successfully cleaned ${chunksCount} upload chunks for ${videoId}.`);
  } catch (err) {
    logger.error(`Error cleaning upload chunks for ${videoId}: ${err.message}`);
  }
}

module.exports = {
  downloadChunks,
  uploadFolderToMinio,
  cleanUploadChunks
};
