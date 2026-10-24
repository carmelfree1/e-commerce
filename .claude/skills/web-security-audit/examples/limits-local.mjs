// Réglages anti-saturation : cache catalogue long (vidé à chaque écriture) et limites par IP adaptées aux réseaux mobiles partagés.
// LOCAL uniquement. Serveur lancé avec TRUST_PROXY=1 (l'IP est lue dans X-Forwarded-For) et le TTL de cache par défaut (600 s).
// Lancer : AUDIT_PW=<mot de passe admin de test> node tests/security/limits-local.mjs
import http from 'node:http';
import pg from 'pg';

const PORT = Number(process.env.AUDIT_PORT) || 3100;
const DB = process.env.AUDIT_DB || 'postgres://postgres:postgres@localhost:15433/postgres';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB)) { console.error('Refus : base non locale.'); process.exit(1); }
const agent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const results = [];
const rec = (id, name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK     ' : 'ÉCHEC  '} ${id.padEnd(3)} ${name}${detail ? '  → ' + detail : ''}`); };

const call = (method, path, { ip, headers = {}, body } = {}) => new Promise((res) => {
  const r = http.request({ host: 'localhost', port: PORT, method, path, agent, headers: { 'X-Forwarded-For': ip, ...headers } }, (x) => {
    const c = []; x.on('data', (d) => c.push(d)); x.on('end', () => { const t = Buffer.concat(c).toString(); let j = {}; try { j = JSON.parse(t); } catch { /* texte */ } res({ s: x.statusCode, j, t, h: x.headers }); });
  });
  r.on('error', () => res({ s: 0, j: {}, t: '', h: {} })); if (body) r.write(body); r.end();
});
const json = (m, p, d, ip, cookie) => { const b = d === undefined ? undefined : JSON.stringify(d); return call(m, p, { ip, headers: { ...(b ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: b }); };
const seq = async (n, fn) => { const out = []; for (let i = 0; i < n; i++) out.push(await fn(i)); return out; };
const firstBlock = (codes) => codes.indexOf(429) + 1;
const db = new pg.Client({ connectionString: DB }); await db.connect();
const q = async (s, p) => (await db.query(s, p)).rows;

const login = await json('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: process.env.AUDIT_PW }, '10.1.0.1');
const cookie = (login.h['set-cookie'] || [])[0]?.split(';')[0];
if (!cookie) { console.error('Connexion admin impossible'); process.exit(1); }
const mk = async (stock) => (await json('POST', '/api/admin/products', { name: 'Produit limite ' + Math.random().toString(36).slice(2, 7), price: 1000, stock }, '10.1.0.2', cookie)).j.id;

/* ===== Cache catalogue ===== */
{
  const id = await mk(10);
  const stock = async () => JSON.parse((await json('GET', '/api/products', undefined, '10.2.0.1')).t).find((p) => p.id === id)?.stock;
  const s0 = await stock();
  await db.query('UPDATE products SET stock = 500 WHERE id = $1', [id]); // modification directe en base, sans passer par l'application
  const cachedView = await stock();
  rec('C1', 'Le catalogue est servi depuis la mémoire (une modification directe en base n\'apparaît pas tout de suite)', s0 === 10 && cachedView === 10, `en cache=${cachedView}, en base=500`);

  await json('PATCH', `/api/admin/products/${id}/stock`, { delta: 1 }, '10.1.0.2', cookie);
  rec('C2', 'Une écriture admin vide le cache immédiatement (le client voit la vraie valeur)', (await stock()) === 501, `stock affiché=${await stock()}`);

  const o = await json('POST', '/api/orders', { name: 'Cache Test', phone: '0722000001', address: 'Abidjan Plateau', items: [{ id, qty: 3 }] }, '10.2.0.9');
  rec('C3', "Une commande vide le cache immédiatement (stock −3 visible tout de suite)", o.s === 201 && (await stock()) === 498, `stock affiché=${await stock()}`);

  // Combien de requêtes SQL sur la table products pendant 300 visites ?
  const reads = async () => Number((await q("SELECT COALESCE(idx_scan,0)+COALESCE(seq_scan,0) AS n FROM pg_stat_user_tables WHERE relname='products'"))[0]?.n ?? NaN);
  await stock(); const before = await reads();
  for (let i = 0; i < 150; i++) { await call('GET', '/', { ip: `10.3.0.${i % 200}`, headers: { 'Accept-Encoding': 'gzip' } }); await call('GET', '/api/products', { ip: `10.3.1.${i % 200}` }); }
  const after = await reads();
  rec('C4', '150 pages d\'accueil + 150 appels catalogue → quasi aucune lecture de la table products (la base peut dormir)', Number.isNaN(before) || after - before <= 2, Number.isNaN(before) ? 'statistiques indisponibles sur cette base de test' : `${after - before} lecture(s) pour 300 requêtes`);
}

/* ===== Limites par IP ===== */
{
  const t = await seq(125, (i) => call('GET', `/api/orders/CCM-T${String(i).padStart(5, '0')}`, { ip: '10.4.0.1' }).then((r) => r.s));
  const other = await call('GET', '/api/orders/CCM-AAAAAA', { ip: '10.4.0.2' });
  rec('L1', 'Suivi : 120 requêtes/min par IP (la 121ᵉ est bloquée), une autre IP n\'est pas affectée', firstBlock(t) === 121 && other.s === 404, `premier 429 à la requête n°${firstBlock(t)}, autre IP → ${other.s}`);

  const cat = await seq(1300, () => call('GET', '/api/products', { ip: '10.4.0.3' }).then((r) => r.s));
  rec('L2', 'Le catalogue n\'est pas compté dans la limite globale (1 300 appels depuis une IP, aucun 429)', !cat.includes(429), `${cat.filter((c) => c === 429).length} blocage(s)`);

  const gl = await seq(1250, () => call('GET', '/api/vapid-key', { ip: '10.4.0.4' }).then((r) => r.s));
  rec('L3', 'Limite globale : 1 200 requêtes/min par IP sur les autres routes API (blocage dès la 1 201ᵉ)', firstBlock(gl) === 1201, `premier 429 à la requête n°${firstBlock(gl)}`);

  const big = await mk(100000);
  const ords = await seq(33, (i) => json('POST', '/api/orders', { name: 'Client Mobile ' + i, phone: '07' + String(30000000 + i), address: 'Abidjan Cocody', items: [{ id: big, qty: 1 }] }, '10.4.0.5').then((r) => r.s));
  rec('L4', 'Commandes : 30 clients derrière une même IP mobile peuvent commander en 10 min, le 31ᵉ est bloqué', ords.slice(0, 30).every((s) => s === 201) && ords[30] === 429, `statuts : ${ords.slice(28, 33).join(',')}`);

  const keys = { p256dh: 'BP' + 'A'.repeat(85), auth: 'A'.repeat(22) };
  const subs = await seq(65, (i) => json('POST', '/api/subscribe', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/limit${i}`, keys } }, '10.4.0.6').then((r) => r.s));
  rec('L5', 'Inscriptions push : 60/heure par IP, la 61ᵉ est bloquée', subs.slice(0, 60).every((s) => s === 200) && subs[60] === 429, `premier 429 à la requête n°${firstBlock(subs)}`);

  const lg = await seq(12, (i) => json('POST', '/api/admin/login', { email: `inconnu${i}@example.invalid`, password: 'x' + i }, '10.4.0.7').then((r) => r.s));
  rec('L6', 'Connexion admin : 10 échecs/15 min par IP (adresses différentes), le 11ᵉ est bloqué', lg.slice(0, 10).every((s) => s === 401) && lg[10] === 429, `statuts : ${lg.slice(8).join(',')}`);

  const fg = await seq(7, (i) => json('POST', '/api/admin/forgot', { email: `oublie${i}@example.invalid` }, '10.4.0.8').then((r) => r.s));
  rec('L7', 'Mot de passe oublié : toujours strict (5 demandes/heure par IP, la 6ᵉ est bloquée)', fg.slice(0, 5).every((s) => s === 200) && fg[5] === 429, `premier 429 à la requête n°${firstBlock(fg)}`);
}

const h = await call('GET', '/healthz', { ip: '10.9.9.9' });
rec('L8', 'Serveur en bonne santé après les rafales', h.s === 200);
console.log(`\nRÉSUMÉ : ${results.filter(Boolean).length}/${results.length} vérifications réussies`);
await db.end(); process.exit(results.every(Boolean) ? 0 : 1);
