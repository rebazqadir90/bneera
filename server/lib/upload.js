import multer from 'multer';
import { put } from '@vercel/blob';
import { randomBytes } from 'node:crypto';

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

export function createUploadMiddleware() {
  function fileFilter(req, file, cb) {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  }
  return multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: MAX_IMAGE_BYTES } });
}

export async function uploadToBlob(file, prefix) {
  const ext = MIME_EXT[file.mimetype] || '';
  const pathname = `${prefix}/${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
  const blob = await put(pathname, file.buffer, { access: 'public', contentType: file.mimetype });
  return blob.url;
}
