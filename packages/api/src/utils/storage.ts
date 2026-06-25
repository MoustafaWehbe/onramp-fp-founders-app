// Storage helpers — configure your S3 bucket via env vars.
// Uncomment the S3 implementation once AWS credentials are configured.

// import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
// import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface UploadResult {
  key: string;
  url: string;
}

export async function uploadFile(
  _key: string,
  _body: Buffer,
  _contentType: string,
): Promise<UploadResult> {
  // TODO: implement S3 upload
  throw new Error(
    "Storage not configured. Set S3_BUCKET and AWS credentials in .env",
  );
}

export async function getPresignedUrl(
  _key: string,
  _expiresIn = 3600,
): Promise<string> {
  // TODO: implement S3 presigned URL
  throw new Error(
    "Storage not configured. Set S3_BUCKET and AWS credentials in .env",
  );
}
