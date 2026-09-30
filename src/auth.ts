import { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { load, save } from './db';
import { User } from './types';
import { HttpError } from './util';

export const me = (req: Request) => (req as any).user as User | undefined;

export function issueToken(userId: string): string {
  const t = randomBytes(24).toString('hex');
  load().meta.tokens[t] = userId; save();
  return t;
}
export function authOptional(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    const db = load();
    const u = db.users.find(x => x.id === db.meta.tokens[h.slice(7)]);
    if (u) (req as any).user = u;
  }
  next();
}
export const requireAuth = (req: Request, _res: Response, next: NextFunction) =>
  me(req) ? next() : next(new HttpError(401, 'Inicia sesión para continuar'));
export const requireAdmin = (req: Request, _res: Response, next: NextFunction) =>
  !me(req) ? next(new HttpError(401, 'Inicia sesión para continuar'))
    : me(req)!.role !== 'admin' ? next(new HttpError(403, 'Solo el administrador puede hacer esto')) : next();
