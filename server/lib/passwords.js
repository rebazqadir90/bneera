import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded).split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scrypt(password, salt, expected.length, {
    N: Number(nStr), r: Number(rStr), p: Number(pStr)
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
