import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { pool } from './db.js';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let secret = config.sessionSecret;
export const setSecret = (s: string) => { secret = s; };

/* ---------- Mots de passe ---------- */
export const hashPassword = async (pw: string, salt: string) => (await scrypt(pw, salt, 64)).toString('hex');
export const newSalt = () => crypto.randomBytes(16).toString('hex');

export async function verifyPassword(pw: string, salt: string, hash: string): Promise<boolean> {
  const got = Buffer.from(await hashPassword(pw, salt), 'hex');
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const MIN_PASSWORD = 10;

/* ---------- Sessions admin ----------
 * Le cookie contient un identifiant de session aléatoire signé (HMAC). Seule l'empreinte SHA-256 de cet
 * identifiant est stockée en base : une fuite de la base ne donne aucune session utilisable, et une
 * déconnexion / un changement de mot de passe révoque réellement les sessions côté serveur.
 */
export const COOKIE_NAME = config.isProd ? '__Host-adm' : 'adm';
export const SESSION_MS = 12 * 3600e3;

/** Empreinte HMAC d'une valeur secrète courte (ex. code à 6 chiffres) : sans la clé du serveur, la base seule ne permet pas de la retrouver. */
export const keyed = (s: string) => crypto.createHmac('sha256', secret).update(`reset:${s}`).digest('hex');

const sign = (s: string) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
const fingerprint = (sid: string) => crypto.createHash('sha256').update(sid).digest('hex');

export async function createSession(adminId: number): Promise<string> {
  const sid = crypto.randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM admin_sessions WHERE expires_at < now()'); // ménage au passage
  await pool.query('INSERT INTO admin_sessions(id, admin_id, expires_at) VALUES ($1,$2, now() + ($3 || \' milliseconds\')::interval)',
    [fingerprint(sid), adminId, String(SESSION_MS)]);
  return `${sid}.${sign(sid)}`;
}

function readSid(token: string | undefined): string | null {
  if (!token || token.length > 200 || !token.includes('.')) return null;
  const [sid, sig] = token.split('.');
  const good = sign(sid);
  if (!sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  return sid;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export const sessionIdOf = (req: Request): string | null => readSid(parseCookies(req.headers.cookie)[COOKIE_NAME]);

export async function destroySession(sid: string): Promise<void> {
  await pool.query('DELETE FROM admin_sessions WHERE id = $1', [fingerprint(sid)]);
}

/** Révoque toutes les sessions d'un admin, sauf éventuellement la session courante. */
export async function destroyOtherSessions(adminId: number, keepSid: string | null): Promise<void> {
  await pool.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND id <> $2', [adminId, keepSid ? fingerprint(keepSid) : '']);
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: { id: number; email: string };
    }
  }
}

export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const sid = sessionIdOf(req);
  const row = sid
    ? (await pool.query<{ id: number; email: string }>(
        `SELECT a.id, a.email FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
         WHERE s.id = $1 AND s.expires_at > now()`, [fingerprint(sid)])).rows[0]
    : undefined;
  if (!row) throw new HttpError(401, 'Non authentifié');
  req.admin = row;
  next();
}

/* ---------- Limitation de débit ---------- */
const limiters: Map<string, number[]>[] = [];
const MAX_KEYS = 20_000;

/** Fenêtre glissante en mémoire : `max` événements par `windowMs`, par clé. Les clés expirées sont purgées. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  limiters.push(hits);
  const fresh = (key: string, now: number) => {
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list); else hits.delete(key);
    return list;
  };
  return {
    blocked(key: string): boolean { return fresh(key, Date.now()).length >= max; },
    hit(key: string): void {
      const now = Date.now();
      if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value as string); // plafond mémoire
      hits.set(key, [...fresh(key, now), now]);
    },
    reset(key: string): void { hits.delete(key); },
    /** Compte l'événement et indique s'il dépasse la limite. */
    take(key: string): boolean {
      if (this.blocked(key)) return false;
      this.hit(key);
      return true;
    },
    _windowMs: windowMs,
    _map: hits,
  };
}

setInterval(() => {
  const now = Date.now();
  for (const m of limiters) for (const [k, v] of m) if (!v.length || now - v[v.length - 1] > 3600e3) m.delete(k);
}, 60_000).unref();

/* ---------- Lecture / validation d'entrées ---------- */
export const toInt = (v: unknown): number =>
  (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()))) && Number.isInteger(Number(v)) ? Number(v) : NaN;

export const toStr = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------- Journal de sécurité (JSON, une ligne par évènement) ---------- */
export function audit(event: string, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), audit: event, ...details }));
}
