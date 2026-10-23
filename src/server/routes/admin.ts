import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { invalidateProducts } from '../cache.js';
import { sendResetCode } from '../mailer.js';
import {
  COOKIE_NAME, HttpError, MIN_PASSWORD, SESSION_MS, audit, createSession, destroyOtherSessions, destroySession,
  hashPassword, keyed, newSalt, rateLimiter, requireAdmin, sessionIdOf, toInt, toStr, verifyPassword,
} from '../security.js';
import { background, isValidSubscription, pushToEndpoint, pushToRole, saveSubscription } from '../push.js';
import crypto from 'node:crypto';
import {
  LOW_STOCK, ORDER_STATUSES, STATUS_LABEL,
  MIN_USAGE_LENGTH, PRODUCT_KINDS,
  type AdminOrder, type AdminProduct, type OrderStatus, type ProductKind, type Stats,
} from '../../shared/types.js';

export const adminRouter = Router();
// Deux verrous : par IP (5 échecs / 15 min) ET par compte (8 échecs / 15 min), pour résister à une IP falsifiée ou distribuée.
const loginIpLimit = rateLimiter(5, 15 * 60e3);
const loginAcctLimit = rateLimiter(8, 15 * 60e3);

/* ----- Connexion (publique) ----- */
adminRouter.post('/login', async (req, res) => {
  const ip = req.ip || '';
  const email = toStr(req.body?.email, 120).toLowerCase();
  if (loginIpLimit.blocked(ip) || loginAcctLimit.blocked(email)) {
    audit('login_blocked', { ip, email });
    throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  }
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 200) : '';
  const a = (await pool.query<{ id: number; salt: string; hash: string }>('SELECT id, salt, hash FROM admins WHERE email = $1', [email])).rows[0];
  // Même coût de calcul que le compte existe ou non (pas de fuite par le temps de réponse).
  const ok = a ? await verifyPassword(password, a.salt, a.hash) : (await hashPassword(password, 'x'.repeat(32)), false);
  if (!a || !ok) {
    loginIpLimit.hit(ip);
    loginAcctLimit.hit(email);
    audit('login_failed', { ip, email });
    throw new HttpError(401, 'Email ou mot de passe incorrect');
  }
  loginIpLimit.reset(ip);
  loginAcctLimit.reset(email);
  audit('login_ok', { ip, email });
  res.cookie(COOKIE_NAME, await createSession(a.id), { httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge: SESSION_MS, path: '/' });
  res.json({ ok: true });
});

adminRouter.post('/logout', async (req, res) => {
  const sid = sessionIdOf(req);
  if (sid) await destroySession(sid);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

/* ----- Mot de passe oublié (public) -----
 * 1) /forgot : l'admin saisit son email → un code à 6 chiffres lui est envoyé (réponse identique que le compte existe ou non).
 * 2) /reset  : il saisit email + code + nouveau mot de passe. Code valable 10 min, 5 essais, usage unique ;
 *    la réussite révoque toutes les sessions ouvertes.
 */
const RESET_MINUTES = 10, RESET_MAX_ATTEMPTS = 5;
const forgotIpLimit = rateLimiter(5, 3600e3);
const forgotMailLimit = rateLimiter(3, 3600e3);
const resetIpLimit = rateLimiter(10, 15 * 60e3);
const resetMailLimit = rateLimiter(8, 15 * 60e3);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const isEmail = (s: string) => s.length <= 254 && EMAIL_RE.test(s);
const sameHash = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

adminRouter.post('/forgot', async (req, res) => {
  const ip = req.ip || '';
  const email = toStr(req.body?.email, 254).toLowerCase();
  if (!forgotIpLimit.take(ip) || !forgotMailLimit.take(email)) {
    audit('reset_rate_limited', { ip });
    throw new HttpError(429, 'Trop de demandes. Réessayez dans une heure.');
  }
  const a = isEmail(email) ? (await pool.query<{ id: number; email: string }>('SELECT id, email FROM admins WHERE email = $1', [email])).rows[0] : undefined;
  if (a) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await tx(async (c) => {
      await c.query('UPDATE password_resets SET used = true WHERE admin_id = $1 AND NOT used', [a.id]); // un seul code actif
      await c.query(`INSERT INTO password_resets(admin_id, code_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
        [a.id, keyed(`${a.id}:${code}`), String(RESET_MINUTES)]);
    });
    audit('reset_requested', { ip, admin: a.email });
    background(sendResetCode(a.email, code, RESET_MINUTES)); // envoi en arrière-plan : le temps de réponse ne révèle pas si le compte existe
  } else {
    await pool.query('SELECT 1');
    audit('reset_requested_unknown', { ip });
  }
  res.json({ ok: true, minutes: RESET_MINUTES });
});

adminRouter.post('/reset', async (req, res) => {
  const ip = req.ip || '';
  const email = toStr(req.body?.email, 254).toLowerCase();
  const code = toStr(req.body?.code, 12);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (resetIpLimit.blocked(ip) || resetMailLimit.blocked(email)) {
    audit('reset_blocked', { ip });
    throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
  }
  if (password.length < MIN_PASSWORD || password.length > 200) {
    throw new HttpError(400, `Le nouveau mot de passe doit faire entre ${MIN_PASSWORD} et 200 caractères`);
  }
  const bad = () => { resetIpLimit.hit(ip); resetMailLimit.hit(email); audit('reset_failed', { ip }); return new HttpError(400, 'Code invalide ou expiré.'); };
  if (!/^\d{6}$/.test(code) || !isEmail(email)) throw bad();

  const outcome = await tx(async (c) => {
    const a = (await c.query<{ id: number }>('SELECT id FROM admins WHERE email = $1', [email])).rows[0];
    if (!a) { sameHash(keyed('0:000000'), keyed('0:000000')); return 'bad' as const; }
    const r = (await c.query<{ id: number; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM password_resets
       WHERE admin_id = $1 AND NOT used AND expires_at > now() ORDER BY id DESC LIMIT 1 FOR UPDATE`, [a.id])).rows[0];
    if (!r) return 'bad' as const;
    if (!sameHash(keyed(`${a.id}:${code}`), r.code_hash)) {
      // 5 mauvais essais : le code est détruit, il faut en redemander un.
      await c.query('UPDATE password_resets SET attempts = attempts + 1, used = (attempts + 1 >= $2) WHERE id = $1', [r.id, RESET_MAX_ATTEMPTS]);
      return 'bad' as const;
    }
    const salt = newSalt();
    await c.query('UPDATE admins SET salt = $1, hash = $2 WHERE id = $3', [salt, await hashPassword(password, salt), a.id]);
    await c.query('UPDATE password_resets SET used = true WHERE admin_id = $1', [a.id]);
    await c.query('DELETE FROM admin_sessions WHERE admin_id = $1', [a.id]); // toutes les sessions ouvertes sont fermées
    return 'ok' as const;
  });
  if (outcome !== 'ok') throw bad();
  resetIpLimit.reset(ip);
  resetMailLimit.reset(email);
  loginIpLimit.reset(ip);
  loginAcctLimit.reset(email); // un compte verrouillé par une attaque est libéré par une réinitialisation légitime
  audit('password_reset', { ip, admin: email });
  res.json({ ok: true });
});

adminRouter.use(requireAdmin);

// Toute écriture authentifiée peut changer produits ou stocks : on vide le cache du catalogue public.
adminRouter.use((req, res, next) => {
  if (req.method !== 'GET') res.on('finish', invalidateProducts);
  next();
});

adminRouter.get('/me', (req, res) => { res.json(req.admin); });

/** Email de connexion et de récupération (c'est là que part le code « mot de passe oublié »). */
adminRouter.post('/email', async (req, res) => {
  const email = toStr(req.body?.email, 254).toLowerCase();
  const current = typeof req.body?.current === 'string' ? req.body.current : '';
  if (!isEmail(email)) throw new HttpError(400, 'Adresse email invalide');
  const a = (await pool.query<{ salt: string; hash: string }>('SELECT salt, hash FROM admins WHERE id = $1', [req.admin!.id])).rows[0];
  if (!(await verifyPassword(current, a.salt, a.hash))) throw new HttpError(403, 'Mot de passe actuel incorrect');
  try {
    await pool.query('UPDATE admins SET email = $1 WHERE id = $2', [email, req.admin!.id]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'Cette adresse est déjà utilisée');
    throw e;
  }
  await pool.query('UPDATE password_resets SET used = true WHERE admin_id = $1', [req.admin!.id]);
  audit('email_changed', { admin: req.admin!.email, to: email, ip: req.ip });
  res.json({ ok: true, email });
});

adminRouter.post('/password', async (req, res) => {
  const { current, next } = (req.body ?? {}) as { current?: unknown; next?: unknown };
  if (typeof next !== 'string' || next.length < MIN_PASSWORD || next.length > 200) throw new HttpError(400, `Le nouveau mot de passe doit faire entre ${MIN_PASSWORD} et 200 caractères`);
  const a = (await pool.query<{ salt: string; hash: string }>('SELECT salt, hash FROM admins WHERE id=$1', [req.admin!.id])).rows[0];
  if (typeof current !== 'string' || !(await verifyPassword(current, a.salt, a.hash))) throw new HttpError(403, 'Mot de passe actuel incorrect');
  const salt = newSalt();
  await pool.query('UPDATE admins SET salt=$1, hash=$2 WHERE id=$3', [salt, await hashPassword(next, salt), req.admin!.id]);
  await destroyOtherSessions(req.admin!.id, sessionIdOf(req)); // toutes les autres sessions sont révoquées
  audit('password_changed', { admin: req.admin!.email, ip: req.ip });
  res.json({ ok: true });
});

/* ----- Tableau de bord ----- */
const ORDER_SELECT = `
  SELECT o.id, o.code, o.customer_name AS "customerName", o.phone, o.address, o.note, o.total, o.status,
         o.created_at AS "createdAt",
         COALESCE((SELECT json_agg(json_build_object('name', i.name, 'price', i.price, 'qty', i.qty, 'image', i.image) ORDER BY i.id)
                   FROM order_items i WHERE i.order_id = o.id), '[]'::json) AS items
  FROM orders o`;

/** Très léger : appelé toutes les 30 s par le panneau pour le compteur et les alertes de nouvelles commandes. */
adminRouter.get('/pulse', async (_req, res) => {
  const r = await pool.query<{ pending: number; last_id: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'en_attente')::int AS pending, COALESCE(MAX(id), 0)::int AS last_id FROM orders`);
  res.json({ pending: r.rows[0].pending, lastId: r.rows[0].last_id });
});

adminRouter.get('/stats', async (_req, res) => {
  // Une requête par bloc, toutes lancées en parallèle ; les agrégats d'orders passent par un seul balayage.
  const [byStatusQ, productsQ, dailyQ, topQ, lowQ, recentQ] = await Promise.all([
    pool.query<{ status: OrderStatus; n: number; total: number; today_n: number; today_total: number }>(`
      SELECT status, COUNT(*)::int AS n, COALESCE(SUM(total), 0)::int AS total,
             COUNT(*) FILTER (WHERE created_at >= current_date)::int AS today_n,
             COALESCE(SUM(total) FILTER (WHERE created_at >= current_date), 0)::int AS today_total
      FROM orders GROUP BY status`),
    pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM products'),
    pool.query<{ day: string; revenue: number; orders: number }>(`
      SELECT to_char(d, 'YYYY-MM-DD') AS day,
             COALESCE(SUM(o.total) FILTER (WHERE o.status <> 'annulee'), 0)::int AS revenue,
             COUNT(o.id)::int AS orders
      FROM generate_series(current_date - 13, current_date, interval '1 day') d
      LEFT JOIN orders o ON o.created_at >= d AND o.created_at < d + interval '1 day'
      GROUP BY d ORDER BY d`),
    pool.query<{ name: string; qty: number }>(`
      SELECT i.name, SUM(i.qty)::int AS qty FROM order_items i JOIN orders o ON o.id = i.order_id
      WHERE o.status <> 'annulee' GROUP BY i.name ORDER BY qty DESC, i.name LIMIT 5`),
    pool.query<{ id: number; name: string; stock: number }>('SELECT id, name, stock FROM products WHERE stock <= $1 ORDER BY stock, name LIMIT 20', [LOW_STOCK]),
    pool.query<AdminOrder>(`${ORDER_SELECT} ORDER BY o.id DESC LIMIT 5`),
  ]);

  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  let orders = 0, revenue = 0, todayOrders = 0, todayRevenue = 0;
  for (const r of byStatusQ.rows) {
    counts[r.status] = r.n;
    orders += r.n;
    todayOrders += r.today_n;
    if (r.status !== 'annulee') { revenue += r.total; todayRevenue += r.today_total; }
  }
  const out: Stats = {
    pending: counts.en_attente, orders, products: productsQ.rows[0].n, revenue, todayOrders, todayRevenue,
    daily: dailyQ.rows, byStatus: counts, top: topQ.rows, lowStock: lowQ.rows, recent: recentQ.rows,
  };
  res.json(out);
});

/* ----- Produits ----- */
const PRODUCT_COLS = `id, name, description, price, category, image, stock, kind, usage, active, created_at AS "createdAt"`;

function readProduct(b: Record<string, unknown> | undefined) {
  const name = toStr(b?.name, 120), price = toInt(b?.price), stock = toInt(b?.stock);
  if (name.length < 2) throw new HttpError(400, 'Nom requis');
  if (!(price >= 0)) throw new HttpError(400, 'Prix invalide');
  if (!(stock >= 0)) throw new HttpError(400, 'Le stock initial est obligatoire (nombre entier ≥ 0)');
  const image = toStr(b?.image, 200);
  if (image && !/^\/uploads\/[\w.-]+$/.test(image)) throw new HttpError(400, 'Image invalide');
  const kind: unknown = b?.kind ?? 'produit';
  if (!PRODUCT_KINDS.includes(kind as ProductKind)) throw new HttpError(400, 'Type de produit invalide');
  const usage = toStr(b?.usage, 2000);
  if (kind === 'medicament' && usage.length < MIN_USAGE_LENGTH) {
    throw new HttpError(400, `Précisez le mode d'emploi du médicament traditionnel (${MIN_USAGE_LENGTH} caractères minimum).`);
  }
  const category = toStr(b?.category, 40) || (kind === 'medicament' ? 'Médicaments traditionnels' : 'Divers');
  return { name, description: toStr(b?.description, 1000), price, category, image, stock, kind: kind as ProductKind, usage, active: b?.active !== false };
}

adminRouter.get('/products', async (_req, res) => {
  res.json((await pool.query<AdminProduct>(`SELECT ${PRODUCT_COLS} FROM products ORDER BY id DESC`)).rows);
});

adminRouter.post('/products', async (req, res) => {
  const p = readProduct(req.body);
  const r = await pool.query<{ id: number }>(
    'INSERT INTO products(name, description, price, category, image, stock, kind, usage, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [p.name, p.description, p.price, p.category, p.image, p.stock, p.kind, p.usage, p.active]);
  res.status(201).json({ id: r.rows[0].id });
});

adminRouter.put('/products/:id', async (req, res) => {
  const p = readProduct(req.body);
  const r = await pool.query(
    'UPDATE products SET name=$1, description=$2, price=$3, category=$4, image=$5, stock=$6, kind=$7, usage=$8, active=$9 WHERE id=$10',
    [p.name, p.description, p.price, p.category, p.image, p.stock, p.kind, p.usage, p.active, toInt(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Produit introuvable');
  res.json({ ok: true });
});

adminRouter.patch('/products/:id/stock', async (req, res) => {
  const delta = Number(req.body?.delta);
  if (!Number.isInteger(delta) || Math.abs(delta) > 100000) throw new HttpError(400, 'Quantité invalide');
  const r = await pool.query<{ stock: number }>(
    'UPDATE products SET stock = stock + $1 WHERE id = $2 AND stock + $1 >= 0 RETURNING stock', [delta, toInt(req.params.id)]);
  if (!r.rowCount) throw new HttpError(400, 'Le stock ne peut pas être négatif');
  res.json(r.rows[0]);
});

adminRouter.patch('/products/:id/active', async (req, res) => {
  const r = await pool.query('UPDATE products SET active = $1 WHERE id = $2', [req.body?.active === true, toInt(req.params.id)]);
  if (!r.rowCount) throw new HttpError(404, 'Produit introuvable');
  res.json({ ok: true });
});

adminRouter.delete('/products/:id', async (req, res) => {
  const r = await pool.query('DELETE FROM products WHERE id=$1', [toInt(req.params.id)]);
  audit('product_deleted', { admin: req.admin!.email, id: req.params.id });
  if (!r.rowCount) throw new HttpError(404, 'Produit introuvable');
  res.json({ ok: true });
});

/* Photo : corps brut, type vérifié par la signature du fichier (jamais par l'extension envoyée). */
adminRouter.post('/upload', express.raw({ type: () => true, limit: '3mb' }), async (req, res) => {
  const b: unknown = req.body;
  if (!Buffer.isBuffer(b) || b.length < 12) throw new HttpError(400, 'Fichier manquant');
  let ext: string | null = null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ext = 'jpg';
  else if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
  else if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') ext = 'webp';
  if (!ext) throw new HttpError(400, 'Format accepté : JPG, PNG ou WebP');
  const file = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
  await fs.promises.writeFile(path.join(config.uploadDir, file), b);
  res.status(201).json({ url: `/uploads/${file}` });
});

/* ----- Commandes ----- */
adminRouter.get('/orders', async (req, res) => {
  const limit = Math.min(Math.max(toInt(req.query.limit) || 300, 1), 500);
  res.json((await pool.query<AdminOrder>(`${ORDER_SELECT} ORDER BY o.id DESC LIMIT $1`, [limit])).rows);
});

adminRouter.patch('/orders/:id/status', async (req, res) => {
  const status: unknown = req.body?.status, id = toInt(req.params.id);
  if (!ORDER_STATUSES.includes(status as OrderStatus)) throw new HttpError(400, 'Statut invalide');
  const next = status as OrderStatus;

  const before = await tx(async (c) => {
    const cur = (await c.query<{ code: string; status: OrderStatus; push_endpoint: string | null }>(
      'SELECT code, status, push_endpoint FROM orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw new HttpError(404, 'Commande introuvable');
    const items = (await c.query<{ product_id: number | null; name: string; qty: number }>(
      'SELECT product_id, name, qty FROM order_items WHERE order_id = $1', [id])).rows;
    if (next === 'annulee' && cur.status !== 'annulee') {
      for (const i of items) if (i.product_id) await c.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [i.qty, i.product_id]);
    } else if (cur.status === 'annulee' && next !== 'annulee') {
      for (const i of items) {
        if (!i.product_id) continue;
        const r = await c.query('UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1', [i.qty, i.product_id]);
        if (!r.rowCount) throw new HttpError(409, `Stock insuffisant pour « ${i.name} », impossible de réactiver.`);
      }
    }
    await c.query('UPDATE orders SET status = $1 WHERE id = $2', [next, id]);
    return cur;
  });

  audit('order_status', { admin: req.admin!.email, order: before.code, from: before.status, to: next });
  res.json({ ok: true });
  if (next !== before.status && before.push_endpoint) {
    background(pushToEndpoint(before.push_endpoint, {
      title: 'CCM-NONSAKA', url: `/?suivi=${before.code}`,
      body: `Votre commande ${before.code} est ${STATUS_LABEL[next].toLowerCase()}.`,
    }));
  }
});

/* ----- Notifications ----- */
adminRouter.get('/push/stats', async (_req, res) => {
  const { rows } = await pool.query<{ role: string; n: number }>('SELECT role, COUNT(*)::int AS n FROM subscriptions GROUP BY role');
  const n = (r: string) => rows.find((x) => x.role === r)?.n ?? 0;
  res.json({ clients: n('client'), admins: n('admin') });
});

adminRouter.post('/push/subscribe', async (req, res) => {
  const sub: unknown = req.body?.subscription;
  if (!isValidSubscription(sub)) throw new HttpError(400, 'Abonnement invalide');
  await saveSubscription(sub, 'admin');
  res.json({ ok: true });
});

adminRouter.post('/push/broadcast', async (req, res) => {
  const title = toStr(req.body?.title, 60), body = toStr(req.body?.body, 200);
  if (!title || !body) throw new HttpError(400, 'Titre et message requis');
  res.json({ sent: await pushToRole('client', { title, body, url: '/' }) });
});
