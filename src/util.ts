import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const uid = (prefix: string) => `${prefix}_${randomBytes(4).toString('hex')}`;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I
export function ticketCode(): string {
  const b = randomBytes(6);
  return 'SGF-' + Array.from(b, x => ALPHABET[x % ALPHABET.length]).join('');
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(12).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function normPlate(p: unknown): string {
  const v = String(p ?? '').toUpperCase().replace(/\s/g, '');
  if (!/^[A-Z0-9-]{3,12}$/.test(v)) throw new HttpError(400, 'La placa debe tener de 3 a 12 letras, números o guiones');
  return v;
}
