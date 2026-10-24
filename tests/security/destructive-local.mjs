// Tests DESTRUCTIFS : à lancer UNIQUEMENT sur une instance LOCALE jetable (base de test). Refuse toute autre cible.
// Lancer : TRUST_PROXY=1 PORT=3100 DATABASE_URL=postgres://postgres:postgres@localhost:15433/postgres ... npm run dev
//          AUDIT_PW=<mot de passe admin de test> node tests/security/destructive-local.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.AUDIT_PORT) || 3100;
const DB = process.env.AUDIT_DB || 'postgres://postgres:postgres@localhost:15433/postgres';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error('Refus : la base cible doit être locale.'); process.exit(1); }
const PW = process.env.AUDIT_PW;
const results = [];
const rec = (id, name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK     ' : 'ÉCHEC  '} ${id.padEnd(4)} ${name}${detail ? '  → ' + detail : ''}`); };

let n = 0;
function raw(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: 'localhost', port: PORT, method, path, headers: { 'X-Forwarded-For': `10.${200 + (++n >> 16)}.${(n >> 8) & 255}.${n & 255}`, ...headers }, timeout: 40000 }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(c) }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code || e.message, headers: {}, buf: Buffer.alloc(0) })); r.on('timeout', () => r.destroy(new Error('timeout')));
    if (body) r.write(body); r.end();
  });
}
const json = async (method, path, data, cookie, extra = {}) => {
  const body = data === undefined ? undefined : JSON.stringify(data);
  const r = await raw(method, path, { headers: { ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, body });
  let d = {}; try { d = JSON.parse(r.buf.toString()); } catch { /* non JSON */ }
  return { ...r, data: d };
};
const ph = () => '07' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const db = new pg.Client({ connectionString: DB }); await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;

const login = await json('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: PW });
const cookie = (login.headers['set-cookie'] || [])[0]?.split(';')[0];
if (!cookie) { console.error('Connexion admin impossible (AUDIT_PW ?)'); process.exit(1); }
const mk = async (extra = {}) => (await json('POST', '/api/admin/products', { name: 'Produit test ' + crypto.randomBytes(3).toString('hex'), price: 1000, stock: 20, ...extra }, cookie)).data.id;
const stockOf = async (id) => (await q('SELECT stock FROM products WHERE id=$1', [id]))[0]?.stock;
const order = (pid, qty = 1) => json('POST', '/api/orders', { name: 'Testeur Destructif', phone: ph(), address: 'Abidjan Plateau', items: [{ id: pid, qty }] });
const TABLES = ['admins', 'admin_sessions', 'password_resets', 'products', 'orders', 'order_items', 'subscriptions', 'settings', 'schema_migrations', 'images'];

/* ===== D1. Chaînes destructrices dans tous les champs texte ===== */
{
  const evil = "x'); DROP TABLE orders; DROP TABLE products;--";
  const evil2 = '"; TRUNCATE order_items CASCADE; --';
  const id = await mk({ name: 'Nom ' + evil, description: evil2, category: evil.slice(0, 40), kind: 'medicament', usage: 'Mode ' + evil + ' ' + evil2 });
  await json('PUT', `/api/admin/products/${id}`, { name: 'Maj ' + evil, price: 500, stock: 3, description: evil2, category: 'x', kind: 'produit', usage: evil }, cookie);
  await json('POST', '/api/admin/push/broadcast', { title: evil.slice(0, 60), body: evil2 }, cookie);
  await json('POST', '/api/orders', { name: evil, phone: ph(), address: evil2 + ' Abidjan', note: evil, items: [{ id, qty: 1 }] });
  const t = (await q("SELECT table_name t FROM information_schema.tables WHERE table_schema='public'")).map((r) => r.t);
  const missing = TABLES.filter((x) => !t.includes(x));
  const cnt = (await q('SELECT (SELECT count(*) FROM products)::int p, (SELECT count(*) FROM orders)::int o, (SELECT count(*) FROM order_items)::int i'))[0];
  rec('D1', 'Chaînes DROP/TRUNCATE dans tous les champs : stockées comme du texte, aucune table touchée', missing.length === 0 && cnt.p > 0 && cnt.o > 0 && cnt.i > 0, missing.length ? 'tables manquantes : ' + missing : `produits=${cnt.p}, commandes=${cnt.o}, lignes=${cnt.i}`);
}

/* ===== D2. Suppression d'un produit : l'historique des commandes survit ===== */
{
  const id = await mk({ name: 'Produit éphémère', price: 1500, stock: 5 });
  const o = await order(id, 2);
  const oid = (await q('SELECT id FROM orders WHERE code=$1', [o.data.code]))[0].id;
  const del = await json('DELETE', `/api/admin/products/${id}`, undefined, cookie);
  const line = (await json('GET', '/api/admin/orders?limit=50', undefined, cookie)).data.find((x) => x.id === oid);
  const cancel = await json('PATCH', `/api/admin/orders/${oid}/status`, { status: 'annulee' }, cookie);
  const react = await json('PATCH', `/api/admin/orders/${oid}/status`, { status: 'en_attente' }, cookie);
  rec('D2', "Produit supprimé : la commande garde nom, prix et quantités ; annuler/réactiver ne plante pas", del.status === 200 && line?.items[0]?.name === 'Produit éphémère' && line.total === 3000 && cancel.status === 200 && react.status === 200, `suppression=${del.status}, annulation=${cancel.status}, réactivation=${react.status}`);
}

/* ===== D3. Annulations simultanées d'une même commande : stock restitué UNE seule fois ===== */
{
  const id = await mk({ stock: 20 });
  const o = await order(id, 5);
  const oid = (await q('SELECT id FROM orders WHERE code=$1', [o.data.code]))[0].id;
  const s0 = await stockOf(id);
  const cancels = await Promise.all(Array.from({ length: 12 }, () => json('PATCH', `/api/admin/orders/${oid}/status`, { status: 'annulee' }, cookie)));
  const s1 = await stockOf(id);
  const reacts = await Promise.all(Array.from({ length: 12 }, () => json('PATCH', `/api/admin/orders/${oid}/status`, { status: 'en_attente' }, cookie)));
  const s2 = await stockOf(id);
  const mix = await Promise.all(Array.from({ length: 16 }, (_, i) => json('PATCH', `/api/admin/orders/${oid}/status`, { status: i % 2 ? 'annulee' : 'confirmee' }, cookie)));
  const final = (await q('SELECT status FROM orders WHERE id=$1', [oid]))[0].status, s3 = await stockOf(id);
  const consistent = final === 'annulee' ? s3 === 20 : s3 === 15;
  rec('D3', '12 annulations simultanées → stock +5 une seule fois ; 12 réactivations → −5 une seule fois ; 16 changements mêlés → cohérent', s0 === 15 && s1 === 20 && s2 === 15 && consistent && [...cancels, ...reacts, ...mix].every((r) => r.status === 200), `stock ${s0}→${s1}→${s2}→${s3} (statut final ${final})`);
}

/* ===== D4/D5. Concurrence sur les stocks ===== */
{
  const id = await mk({ stock: 10 });
  await Promise.all(Array.from({ length: 40 }, () => json('PATCH', `/api/admin/products/${id}/stock`, { delta: 1 }, cookie)));
  rec('D4', '40 ajouts de stock simultanés (+1) → exactement +40', (await stockOf(id)) === 50, `stock=${await stockOf(id)}`);

  const id2 = await mk({ stock: 10 });
  const orders = Array.from({ length: 15 }, () => order(id2, 1));
  const dec = Array.from({ length: 10 }, () => json('PATCH', `/api/admin/products/${id2}/stock`, { delta: -1 }, cookie));
  const [o, d] = [await Promise.all(orders), await Promise.all(dec)];
  const okOrders = o.filter((r) => r.status === 201).length, okDec = d.filter((r) => r.status === 200).length, left = await stockOf(id2);
  rec('D5', '15 commandes + 10 retraits admin en parallèle sur 10 unités → stock jamais négatif, aucune unité perdue ni créée', left >= 0 && okOrders + okDec + left === 10, `commandes=${okOrders}, retraits=${okDec}, restant=${left}`);
}

/* ===== D6. Débordements numériques (entiers 32 bits en base) ===== */
{
  const bad = [];
  for (const [label, body] of [['prix 99999999999', { price: 99999999999 }], ['prix 2^31', { price: 2147483648 }], ['stock 2^31', { stock: 2147483648 }], ['prix 1e21', { price: 1e21 }], ['stock 1e308', { stock: 1e308 }]]) {
    const r = await json('POST', '/api/admin/products', { name: 'Débordement', price: 100, stock: 5, ...body }, cookie);
    if (r.status < 400 || r.status >= 500) bad.push(`${label}=${r.status}`);
  }
  const id = await mk({ price: 5000, stock: 5 });
  const r = await json('PATCH', `/api/admin/products/${id}/stock`, { delta: 100000 }, cookie);
  await json('PATCH', `/api/admin/products/${id}/stock`, { delta: 100000 }, cookie);
  const big = await mk({ price: 100000000, stock: 1000000 }); // plafonds attendus
  const ord = await json('POST', '/api/orders', { name: 'Gros Acheteur', phone: ph(), address: 'Abidjan Plateau', items: [{ id: big, qty: 99 }] });
  if (big && ord.status >= 500) bad.push(`total 9,9 milliards=${ord.status}`);
  rec('D6', 'Prix/stock/total hors limites → refus 4xx propre (jamais 500, jamais de dépassement d\'entier)', bad.length === 0, bad.join(', '));
}

/* ===== D7. Caractères piégés (octet NUL, surrogates, très longues chaînes) ===== */
{
  const bad = [];
  const cases = [['NUL dans le nom', { name: 'ab\u0000cd' }], ['NUL dans la description', { description: 'x\u0000y' }], ['surrogate isolé', { name: 'Nom \ud800 cassé' }], ['10 000 emojis', { name: '😀'.repeat(10000) }], ['RTL/zéro-largeur', { name: 'a‮b​c' }]];
  for (const [l, patch] of cases) { const r = await json('POST', '/api/admin/products', { name: 'Test unicode', price: 100, stock: 1, ...patch }, cookie); if (r.status >= 500) bad.push(`${l}=${r.status}`); }
  const o = await json('POST', '/api/orders', { name: 'Marie\u0000', phone: ph(), address: 'Abidjan\u0000 Cocody', items: [{ id: await mk(), qty: 1 }] });
  if (o.status >= 500) bad.push(`commande NUL=${o.status}`);
  const extra = [
    ['suivi avec %00', await raw('GET', '/api/orders/CCM%00X')],
    ['id produit abc dans URL', await json('PATCH', '/api/admin/products/abc/stock', { delta: 1 }, cookie)],
    ['id produit 99999999999 dans URL', await json('DELETE', '/api/admin/products/99999999999', undefined, cookie)],
    ['id commande -5', await json('PATCH', '/api/admin/orders/-5/status', { status: 'livree' }, cookie)],
    ['commande avec id article 99999999999', await json('POST', '/api/orders', { name: 'Test Id', phone: ph(), address: 'Abidjan Plateau', items: [{ id: 99999999999, qty: 1 }] })],
    ['abonnement push avec NUL dans URL', await json('POST', '/api/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/a' + String.fromCharCode(0) + 'b', keys: { p256dh: 'BP' + 'A'.repeat(85), auth: 'A'.repeat(22) } } })],
  ];
  for (const [l, r] of extra) if (r.status >= 500 || r.status === 0) bad.push(`${l}=${r.status}`);
  rec('D7', 'Octet NUL, surrogates isolés, emojis, caractères directionnels → jamais d\'erreur 500', bad.length === 0, bad.join(', '));
}

/* ===== D8. En-têtes / URL monstrueux ===== */
{
  const bad = [];
  const longUrl = await raw('GET', '/api/orders/' + 'A'.repeat(20000)); if (longUrl.status === 0 || longUrl.status >= 500) bad.push(`URL 20 Ko=${longUrl.status || longUrl.error}`);
  const bigHdr = await raw('GET', '/', { headers: { 'X-Junk': 'B'.repeat(20000) } }); if (bigHdr.status >= 500) bad.push(`en-tête 20 Ko=${bigHdr.status}`);
  const manyCookies = await raw('GET', '/api/admin/me', { headers: { Cookie: Array.from({ length: 300 }, (_, i) => `c${i}=${'v'.repeat(20)}`).join('; ') } }); if (manyCookies.status >= 500) bad.push(`300 cookies=${manyCookies.status}`);
  const alive = await raw('GET', '/healthz');
  rec('D8', 'URL de 20 Ko, en-tête de 20 Ko, 300 cookies → refus propre, serveur toujours vivant', bad.length === 0 && alive.status === 200, bad.join(', '));
}

/* ===== D9. Sessions et mots de passe en parallèle ===== */
{
  const logins = await Promise.all(Array.from({ length: 12 }, () => json('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: PW })));
  const cookies = logins.map((r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0]).filter(Boolean);
  const pw2 = 'Mot-De-Passe-Test-Parallele-' + crypto.randomBytes(3).toString('hex');
  const changes = await Promise.all(cookies.slice(0, 6).map((c, i) => json('POST', '/api/admin/password', { current: PW, next: i === 0 ? pw2 : PW }, c)));
  const afterLogin = await json('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: pw2 });
  const afterOld = await json('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: PW });
  const hashes = (await q('SELECT count(*)::int n FROM admins'))[0].n;
  // le mot de passe final est soit pw2 soit PW (ordre d'exécution) : un seul des deux fonctionne, jamais les deux, jamais aucun
  const works = [afterLogin.status === 200, afterOld.status === 200];
  rec('D9', '12 connexions + 6 changements de mot de passe simultanés → un seul mot de passe final valide, un seul compte', hashes === 1 && works.filter(Boolean).length === 1 && changes.every((r) => r.status === 200 || r.status === 403 || r.status === 401), `changements=${changes.map((r) => r.status).join(',')}, final=${works[0] ? 'nouveau' : 'ancien'}`);
  if (works[0]) { const c = (afterLogin.headers['set-cookie'] || [])[0].split(';')[0]; await json('POST', '/api/admin/password', { current: pw2, next: PW }, c); }
}

/* ===== D10. Envoi massif de photos et d'abonnements ===== */
{
  const fresh = await json('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: PW });
  const cookie2 = (fresh.headers['set-cookie'] || [])[0]?.split(';')[0];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(600 * 1024)]);
  const ups = await Promise.all(Array.from({ length: 20 }, () => raw('POST', '/api/admin/upload', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': png.length, Cookie: cookie2 }, body: png })));
  const keys = { p256dh: 'BP' + 'A'.repeat(85), auth: 'A'.repeat(22) };
  const same = await Promise.all(Array.from({ length: 15 }, () => json('POST', '/api/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/course-critique', keys } })));
  const rows = (await q("SELECT count(*)::int n FROM subscriptions WHERE endpoint='https://fcm.googleapis.com/fcm/send/course-critique'"))[0].n;
  rec('D10', '20 photos de 600 Ko en parallèle et 15 inscriptions push identiques simultanées → tout accepté sans erreur, une seule ligne d\'abonnement', ups.every((r) => r.status === 201) && same.every((r) => r.status === 200 || r.status === 429) && rows === 1, `photos=${ups.filter((r) => r.status === 201).length}/20, abonnements en base=${rows}`);
}

const alive = await raw('GET', '/healthz');
rec('D11', 'Serveur toujours en vie et en bonne santé à la fin de la batterie', alive.status === 200);
console.log(`\nRÉSUMÉ : ${results.filter(Boolean).length}/${results.length} vérifications réussies`);
await db.end();
process.exit(results.every(Boolean) ? 0 : 1);
