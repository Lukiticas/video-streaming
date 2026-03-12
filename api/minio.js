const { Client } = require('minio');
const config = require('./config');

const minioClient = new Client(config.minio);
const BUCKET_UPLOADS = config.minio.buckets.uploads;
const BUCKET_PROCESSED = config.minio.buckets.processed;

/**
 * Initialize MinIO buckets and policies
 */
async function initBucket(logger) {
  try {
    const exists = await minioClient.bucketExists(BUCKET_UPLOADS);
    if (!exists) {
      await minioClient.makeBucket(BUCKET_UPLOADS);

      const corsPolicy = {
        Version: "2012-10-17",
        Statement: [
          {
            Action: ["s3:PutObject"],
            Effect: "Allow",
            Principal: { "AWS": ["*"] },
            Resource: [`arn:aws:s3:::${BUCKET_UPLOADS}/*`]
          }
        ]
      };
      await minioClient.setBucketPolicy(BUCKET_UPLOADS, JSON.stringify(corsPolicy));
      if (logger) logger.info(`Bucket ${BUCKET_UPLOADS} created and configured.`);
    }

    const processedExists = await minioClient.bucketExists(BUCKET_PROCESSED);
    if (!processedExists) {
      await minioClient.makeBucket(BUCKET_PROCESSED);

      const readPolicy = {
        Version: "2012-10-17",
        Statement: [
          {
            Action: ["s3:GetObject"],
            Effect: "Allow",
            Principal: { "AWS": ["*"] },
            Resource: [`arn:aws:s3:::${BUCKET_PROCESSED}/*`]
          }
        ]
      };
      await minioClient.setBucketPolicy(BUCKET_PROCESSED, JSON.stringify(readPolicy));
      if (logger) logger.info(`Bucket ${BUCKET_PROCESSED} created and configured for public read.`);
    }
  } catch (err) {
    if (logger) logger.error('Error initializing MinIO bucket:', err);
  }
}

/**
 * Generate presigned URLs for a chunked upload
 */
async function generatePresignedUrls(videoId, chunksCount) {
  const urls = [];
  for (let i = 1; i <= chunksCount; i++) {
    const chunkKey = `${videoId}/chunk_${String(i).padStart(3, '0')}.part`;
    const presignedUrl = await minioClient.presignedPutObject(BUCKET_UPLOADS, chunkKey, 24 * 60 * 60);

    urls.push({
      partNumber: i,
      url: presignedUrl,
      chunkKey: chunkKey
    });
  }
  return urls;
}

module.exports = {
  minioClient,
  initBucket,
  generatePresignedUrls
};
