import { Router } from 'express';
import crypto from 'node:crypto';
import { pool, tx } from '../db.js';
import { getPublicProducts, invalidateProducts } from '../cache.js';
import { LIMITS } from '../limits.js';
import { orderWhatsappUrl } from '../whatsapp.js';
import { HttpError, rateLimiter, toInt, toStr } from '../security.js';
import { background, isValidSubscription, pushToRole, saveSubscription, vapidPublicKey } from '../push.js';
import { LOW_STOCK, STATUS_LABEL, type CheckoutPayload, type OrderStatus, type TrackedOrder } from '../../shared/types.js';

export const publicRouter = Router();
const orderLimit = rateLimiter(LIMITS.order.max, LIMITS.order.windowMs);
const trackLimit = rateLimiter(LIMITS.track.max, LIMITS.track.windowMs); // anti-énumération des codes de commande
const subscribeLimit = rateLimiter(LIMITS.subscribe.max, LIMITS.subscribe.windowMs);
const limited = (l: ReturnType<typeof rateLimiter>, req: { ip?: string }) => {
  if (!l.take(req.ip || '')) throw new HttpError(429, 'Trop de requêtes, réessayez plus tard.');
};
const MAX_ORDER_TOTAL = 2_000_000_000; // la colonne `total` est un entier 32 bits
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => 'CCM-' + Array.from(crypto.randomBytes(6), (x) => ALPHABET[x % 32]).join('');

publicRouter.get('/products', async (req, res) => {
  const c = await getPublicProducts();
  // ETag + courte fraîcheur : la plupart des appels répondent en 304 sans corps, ou directement depuis le cache du navigateur.
  res.set({ ETag: c.etag, 'Cache-Control': 'public, max-age=3, stale-while-revalidate=30' });
  if (req.fresh) { res.status(304).end(); return; }
  res.type('json').send(c.json);
});

publicRouter.get('/vapid-key', (_req, res) => { res.json({ key: vapidPublicKey() }); });

publicRouter.post('/subscribe', async (req, res) => {
  limited(subscribeLimit, req);
  const sub: unknown = req.body?.subscription;
  if (!isValidSubscription(sub)) throw new HttpError(400, 'Abonnement invalide');
  await saveSubscription(sub, 'client');
  res.json({ ok: true });
});

publicRouter.post('/orders', async (req, res) => {
  if (orderLimit.blocked(req.ip || '')) throw new HttpError(429, 'Trop de commandes, réessayez plus tard.');
  orderLimit.hit(req.ip || '');

  const b = (req.body ?? {}) as Partial<CheckoutPayload>;
  const name = toStr(b.name, 80), phone = toStr(b.phone, 20), address = toStr(b.address, 300), note = toStr(b.note, 300);
  if (name.length < 2) throw new HttpError(400, 'Nom requis');
  if (!/^[+\d][\d\s.-]{5,19}$/.test(phone)) throw new HttpError(400, 'Numéro de téléphone invalide');
  if (address.length < 5) throw new HttpError(400, 'Adresse de livraison requise');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) throw new HttpError(400, 'Panier vide');

  const wanted = new Map<number, number>();
  for (const it of b.items) {
    const id = toInt(it?.id), qty = toInt(it?.qty);
    if (!(id > 0) || !(qty >= 1 && qty <= 99)) throw new HttpError(400, 'Article invalide');
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  // Anti-accaparement du stock : au plus 3 commandes en attente par numéro de téléphone sur 24 h.
  const digits = phone.replace(/\D/g, '');
  const pending = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM orders
     WHERE status = 'en_attente' AND regexp_replace(phone, '\\D', '', 'g') = $1 AND created_at > now() - interval '24 hours'`, [digits]);
  if (pending.rows[0].n >= 3) throw new HttpError(429, 'Plusieurs commandes sont déjà en attente avec ce numéro. Contactez-nous sur WhatsApp.');
  const sub = isValidSubscription(b.subscription) ? b.subscription : null;
  if (sub) await saveSubscription(sub, 'client');

  const order = await tx(async (c) => {
    const ids = [...wanted.keys()];
    // Verrou ligne par ligne, dans un ordre stable : deux commandes simultanées ne peuvent pas survendre le stock.
    const { rows: prods } = await c.query<{ id: number; name: string; price: number; stock: number; image: string }>(
      'SELECT id, name, price, stock, image FROM products WHERE id = ANY($1) AND active ORDER BY id FOR UPDATE', [ids]);
    if (prods.length !== ids.length) throw new HttpError(409, "Un article n'est plus disponible.");

    let total = 0;
    const low: { name: string; left: number }[] = [];
    for (const p of prods) {
      const qty = wanted.get(p.id)!;
      if (p.stock < qty) throw new HttpError(409, p.stock === 0 ? `« ${p.name} » est en rupture de stock.` : `« ${p.name} » : il ne reste que ${p.stock} en stock.`);
      await c.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [qty, p.id]);
      total += p.price * qty;
      if (total > MAX_ORDER_TOTAL) throw new HttpError(400, 'Montant de commande trop élevé : contactez-nous directement.');
      if (p.stock - qty <= LOW_STOCK) low.push({ name: p.name, left: p.stock - qty });
    }

    let orderId = 0, code = '';
    for (let attempt = 0; attempt < 5 && !orderId; attempt++) {
      code = newCode();
      const r = await c.query<{ id: number }>(
        `INSERT INTO orders(code, customer_name, phone, address, note, total, push_endpoint)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING RETURNING id`,
        [code, name, phone, address, note, total, sub?.endpoint ?? null]);
      orderId = r.rows[0]?.id ?? 0;
    }
    if (!orderId) throw new HttpError(500, 'Impossible de créer la commande, réessayez.');
    for (const p of prods) {
      await c.query('INSERT INTO order_items(order_id, product_id, name, price, qty, image) VALUES ($1,$2,$3,$4,$5,$6)',
        [orderId, p.id, p.name, p.price, wanted.get(p.id), p.image]);
    }
    const lines = prods.map((p) => ({ name: p.name, price: p.price, qty: wanted.get(p.id)! }));
    return { code, total, low, lines };
  });

  invalidateProducts();
  // La commande est reçue sur WhatsApp : le serveur rédige le message (prix et noms réels, jamais ceux envoyés par le navigateur).
  const whatsappUrl = orderWhatsappUrl({ code: order.code, customerName: name, phone, address, note, total: order.total, lines: order.lines });
  res.status(201).json({ code: order.code, total: order.total, whatsappUrl });
  background(pushToRole('admin', {
    title: 'Nouvelle commande', url: '/admin/#commandes',
    body: `${order.code} — ${name} — ${order.total.toLocaleString('fr-FR')} FCFA`,
  }));
  for (const l of order.low) {
    background(pushToRole('admin', { title: 'Stock bas', body: `${l.name} : ${l.left} restant(s)`, url: '/admin/#produits' }));
  }
});

publicRouter.get('/orders/:code', async (req, res) => {
  limited(trackLimit, req);
  const code = String(req.params.code).toUpperCase();
  if (!/^CCM-[A-Z0-9]{6}$/.test(code)) throw new HttpError(404, 'Commande introuvable'); // format invalide : inutile (et risqué) d'interroger la base
  const { rows } = await pool.query<Omit<TrackedOrder, 'statusLabel'> & { id: number }>(
    'SELECT id, code, status, total, created_at AS "createdAt" FROM orders WHERE code = $1', [code]);
  const o = rows[0];
  if (!o) throw new HttpError(404, 'Commande introuvable');
  const items = (await pool.query('SELECT name, price, qty FROM order_items WHERE order_id = $1 ORDER BY id', [o.id])).rows;
  const out: TrackedOrder = { code: o.code, status: o.status as OrderStatus, statusLabel: STATUS_LABEL[o.status as OrderStatus].toLowerCase(), total: o.total, createdAt: o.createdAt, items };
  res.json(out);
});
