import webpush from 'web-push';
import { getSetting, pool, setSetting } from './db.js';
import { config } from './config.js';
import type { PushSubscriptionJSON } from '../shared/types.js';

export interface PushPayload { title: string; body: string; url: string }
interface SubRow { endpoint: string; data: PushSubscriptionJSON }

let publicKey = '';
export const vapidPublicKey = () => publicKey;

export async function initPush(): Promise<void> {
  let pub = await getSetting('vapid_public');
  let priv = await getSetting('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    await setSetting('vapid_public', pub);
    await setSetting('vapid_private', priv);
  }
  publicKey = pub;
  webpush.setVapidDetails(`mailto:${config.adminEmail}`, pub, priv);
}

/**
 * Services push légitimes des navigateurs. Le serveur envoie une requête HTTPS vers l'`endpoint` fourni par le client :
 * sans liste blanche, un attaquant pourrait faire appeler n'importe quelle adresse (SSRF) par le serveur.
 */
const PUSH_HOSTS = [
  'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com',
  'notify.windows.com', 'push.apple.com', 'web.push.apple.com',
];

export function isAllowedEndpoint(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  for (let i = 0; i < endpoint.length; i++) if (endpoint.charCodeAt(i) < 32 || endpoint.charCodeAt(i) === 127) return false; // NUL & co. feraient échouer le stockage JSONB
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const b64urlLen = (s: unknown, bytes: number): boolean =>
  typeof s === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(s) && Buffer.from(s, 'base64url').length === bytes;

export const isValidSubscription = (s: unknown): s is PushSubscriptionJSON => {
  const x = s as Partial<PushSubscriptionJSON> | null;
  return !!x && typeof x.endpoint === 'string' && isAllowedEndpoint(x.endpoint)
    && !!x.keys && b64urlLen(x.keys.p256dh, 65) && b64urlLen(x.keys.auth, 16);
};

export async function saveSubscription(sub: PushSubscriptionJSON, role: 'admin' | 'client'): Promise<void> {
  // Un appareil devenu admin ne repasse pas client automatiquement.
  await pool.query(
    `INSERT INTO subscriptions(endpoint,data,role) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET data = EXCLUDED.data,
       role = CASE WHEN subscriptions.role = 'admin' THEN 'admin' ELSE EXCLUDED.role END`,
    [sub.endpoint, JSON.stringify(sub), role],
  );
}

export async function sendPush(rows: SubRow[], payload: PushPayload): Promise<void> {
  const body = JSON.stringify(payload);
  await Promise.all(rows.map(async (r) => {
    try {
      await webpush.sendNotification(r.data, body, { TTL: 86400 });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await pool.query('DELETE FROM subscriptions WHERE endpoint=$1', [r.endpoint]);
    }
  }));
}

export async function pushToRole(role: 'admin' | 'client', payload: PushPayload): Promise<number> {
  const { rows } = await pool.query<SubRow>('SELECT endpoint, data FROM subscriptions WHERE role=$1', [role]);
  await sendPush(rows, payload);
  return rows.length;
}

export async function pushToEndpoint(endpoint: string, payload: PushPayload): Promise<void> {
  const { rows } = await pool.query<SubRow>('SELECT endpoint, data FROM subscriptions WHERE endpoint=$1', [endpoint]);
  await sendPush(rows, payload);
}

/** Envoi « fire and forget » : une panne de push ne doit jamais casser une requête. */
export const background = (p: Promise<unknown>) => { p.catch((e) => console.error("Tâche d'arrière-plan en échec :", (e as Error).message)); };
