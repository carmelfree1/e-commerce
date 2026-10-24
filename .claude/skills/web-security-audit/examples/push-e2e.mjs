// Test de bout en bout des notifications push, 100 % local :
// le serveur envoie vers un FAUX service push (https://localhost:9443) qui reçoit, déchiffre et vérifie chaque message
// exactement comme le ferait un navigateur (chiffrement RFC 8291 + signature VAPID).
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire('C:/Mes_projets/e-commerce/package.json');
const ece = require('http_ece');
const TLS = process.env.TLS_DIR;
const API = 'http://localhost:3100';
const ADMIN = { email: 'admin@ccm-nonsaka.com', password: process.env.AUDIT_PW };

const results = [];
const rec = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK     ' : 'ÉCHEC  '} ${name}${detail ? '  → ' + detail : ''}`); };

/* ---- Faux service push ---- */
const received = []; // { path, headers, payload, jwtOk }
const devices = {}; // chemin -> { ecdh, auth }
function newDevice(path) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  devices[path] = { ecdh, auth };
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
}
let vapidPublic = '';
const server = https.createServer({ key: fs.readFileSync(`${TLS}/k.pem`), cert: fs.readFileSync(`${TLS}/c.pem`) }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.url === '/gone') { res.statusCode = 410; return res.end(); }
    const body = Buffer.concat(chunks);
    const d = devices[req.url];
    let payload = null, jwtOk = false;
    try {
      payload = JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: d.ecdh, authSecret: d.auth.toString('base64url') }).toString());
    } catch (e) { payload = { error: String(e.message || e) }; }
    // Signature VAPID : Authorization: vapid t=<jwt>, k=<clé publique>
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.authorization || '');
    if (m) {
      const [h, p, s] = m[1].split('.');
      const pub = Buffer.from(m[2], 'base64url');
      const jwk = { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') };
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const claims = JSON.parse(Buffer.from(p, 'base64url'));
      jwtOk = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
        && m[2] === vapidPublic && claims.aud === 'https://localhost:9443' && claims.exp > Date.now() / 1000 && /^mailto:/.test(claims.sub);
    }
    received.push({ path: req.url, headers: req.headers, payload, jwtOk });
    res.statusCode = 201; res.end();
  });
});
await new Promise((r) => server.listen(9443, r));

/* ---- Utilitaires ---- */
const db = new pg.Client({ connectionString: 'postgres://postgres:postgres@localhost:15433/postgres' });
await db.connect();
const j = async (method, path, body, cookie) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': `10.50.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers };
};
const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; };
const sub = (path, keys) => JSON.stringify({ endpoint: `https://localhost:9443${path}`, expirationTime: null, keys });
const ph = () => '07' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

/* ---- Préparation ---- */
vapidPublic = (await j('GET', '/api/vapid-key')).data.key;
rec('Clé publique VAPID exposée au navigateur (65 octets)', Buffer.from(vapidPublic, 'base64url').length === 65);
const login = await j('POST', '/api/admin/login', ADMIN);
const cookie = (login.headers.getSetCookie?.()[0] || '').split(';')[0];
rec('Connexion admin', login.status === 200 && !!cookie);

await db.query("DELETE FROM subscriptions WHERE endpoint LIKE 'https://localhost:9443%'");
const adminKeys = newDevice('/admin-device'), clientKeys = newDevice('/client-device');
await db.query("INSERT INTO subscriptions(endpoint,data,role) VALUES ($1,$2,'admin')", ['https://localhost:9443/admin-device', sub('/admin-device', adminKeys)]);
await db.query("INSERT INTO subscriptions(endpoint,data,role) VALUES ($1,$2,'client')", ['https://localhost:9443/client-device', sub('/client-device', clientKeys)]);
const goneKeys = newDevice('/gone');
await db.query("INSERT INTO subscriptions(endpoint,data,role) VALUES ($1,$2,'client')", ['https://localhost:9443/gone', sub('/gone', goneKeys)]);

/* 1. Nouvelle commande -> notification à l'admin */
const prods = (await j('GET', '/api/products')).data;
const p = prods.find((x) => x.stock > 10 && x.kind === 'produit');
const order = await j('POST', '/api/orders', { name: 'Marie Koné', phone: ph(), address: 'Abidjan Cocody', items: [{ id: p.id, qty: 1 }] });
rec('Commande créée', order.status === 201, order.data.code);
const adminMsg = await waitFor(() => received.find((r) => r.path === '/admin-device' && /Nouvelle commande/.test(r.payload?.title || '')));
rec("L'admin reçoit « Nouvelle commande » (déchiffrée avec les clés de l'appareil)", !!adminMsg, adminMsg ? `${adminMsg.payload.body} → ${adminMsg.payload.url}` : '');
rec('Signature VAPID valide (JWT ES256, audience, expiration, contact)', !!adminMsg?.jwtOk);
rec("En-têtes conformes (aes128gcm, TTL)", adminMsg?.headers['content-encoding'] === 'aes128gcm' && Number(adminMsg?.headers.ttl) > 0, `${adminMsg?.headers['content-encoding']}, TTL=${adminMsg?.headers.ttl}`);

/* 2. Changement de statut -> notification au client de la commande */
await db.query('UPDATE orders SET push_endpoint = $1 WHERE code = $2', ['https://localhost:9443/client-device', order.data.code]);
const oid = (await db.query('SELECT id FROM orders WHERE code=$1', [order.data.code])).rows[0].id;
const patch = await j('PATCH', `/api/admin/orders/${oid}/status`, { status: 'confirmee' }, cookie);
const clientMsg = await waitFor(() => received.find((r) => r.path === '/client-device' && new RegExp(order.data.code).test(r.payload?.body || '')));
rec('Le client reçoit « Votre commande … est confirmée »', patch.status === 200 && !!clientMsg, clientMsg ? clientMsg.payload.body : '');
rec('Le lien de la notification ouvre le suivi (/?suivi=CODE)', clientMsg?.payload.url === `/?suivi=${order.data.code}`, clientMsg?.payload.url);

/* 3. Stock bas -> alerte admin */
const c = await j('POST', '/api/admin/products', { name: 'Produit alerte stock', price: 700, stock: 6 }, cookie);
const before = received.length;
await j('POST', '/api/orders', { name: 'Awa Traoré', phone: ph(), address: 'Abidjan Yopougon', items: [{ id: c.data.id, qty: 3 }] });
const low = await waitFor(() => received.slice(before).find((r) => r.path === '/admin-device' && /Stock bas/.test(r.payload?.title || '')));
rec("Alerte « Stock bas » envoyée à l'admin", !!low, low ? low.payload.body : '');

/* 4. Annonce admin -> tous les clients ; abonnement expiré (410) nettoyé */
const bc = await j('POST', '/api/admin/push/broadcast', { title: 'Promo du week-end', body: 'Jusqu’à -20 % sur les fruits frais.' }, cookie);
const ann = await waitFor(() => received.find((r) => r.path === '/client-device' && r.payload?.title === 'Promo du week-end'));
rec('Annonce reçue par les clients abonnés', bc.status === 200 && !!ann, `envoyée à ${bc.data.sent} appareil(s)`);
const goneLeft = await waitFor(async () => false, 300); // laisse le temps au nettoyage
await new Promise((r) => setTimeout(r, 800));
const gone = await db.query("SELECT 1 FROM subscriptions WHERE endpoint='https://localhost:9443/gone'");
rec('Abonnement expiré (le service répond 410) supprimé automatiquement', gone.rowCount === 0);
const admins = await db.query("SELECT COUNT(*)::int n FROM subscriptions WHERE role='admin' AND endpoint LIKE 'https://localhost:9443%'");
rec("Un appareil admin ne reçoit pas les annonces clients", !received.some((r) => r.path === '/admin-device' && r.payload?.title === 'Promo du week-end'));

console.log(`\nRÉSUMÉ : ${results.filter(Boolean).length}/${results.length} vérifications réussies`);
await db.query("DELETE FROM subscriptions WHERE endpoint LIKE 'https://localhost:9443%'");
await db.end(); server.close();
process.exit(results.every(Boolean) ? 0 : 1);
