import multer from 'multer';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

export function createUploadMiddleware(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination(req, file, cb) {
      cb(null, uploadDir);
    },
    filename(req, file, cb) {
      const ext = MIME_EXT[file.mimetype] || '';
      cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
    }
  });

  function fileFilter(req, file, cb) {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'image'));
  }

  return multer({ storage, fileFilter, limits: { fileSize: MAX_IMAGE_BYTES } });
}
