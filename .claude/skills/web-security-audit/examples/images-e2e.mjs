// ⚠ Ne cible QUE localhost. Lancer depuis la racine du projet : AUDIT_PW=<mot de passe admin de test> node tests/security/images-e2e.mjs
// Photos produits stockées en base : upload, service, cache, survie au redémarrage, nettoyage. Cible : localhost uniquement.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const PW = process.env.AUDIT_PW, PNG = fs.readFileSync('public/icons/icon-192.png');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const results = [];
const rec = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK     ' : 'ÉCHEC  '} ${name}${detail ? '  → ' + detail : ''}`); };

function raw(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: 'localhost', port: 3100, method, path, headers: { 'X-Forwarded-For': `10.80.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers } }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}
const json = async (method, path, data, cookie) => {
  const body = data === undefined ? undefined : JSON.stringify(data);
  const r = await raw(method, path, { headers: { ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body });
  let parsed = {}; try { parsed = JSON.parse(r.body.toString()); } catch { /* binaire */ }
  return { ...r, data: parsed };
};
const db = new pg.Client({ connectionString: 'postgres://postgres:postgres@localhost:15433/postgres' });
await db.connect();

const login = await json('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: PW });
const cookie = (login.headers['set-cookie'] || [])[0]?.split(';')[0];
const upload = (buf) => raw('POST', '/api/admin/upload', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, Cookie: cookie }, body: buf });

const diskBefore = fs.existsSync('uploads') ? fs.readdirSync('uploads').length : 0;

/* 1. Upload -> base, pas disque */
const up = await upload(PNG);
const url = JSON.parse(up.body.toString()).url;
rec('Upload accepté, URL /uploads/<nom>.png', up.status === 201 && /^\/uploads\/[a-f0-9]{24}\.png$/.test(url), url);
const diskAfter = fs.existsSync('uploads') ? fs.readdirSync('uploads').length : 0;
rec('Rien n\'est écrit sur le disque du serveur', diskAfter === diskBefore, `fichiers avant/après : ${diskBefore}/${diskAfter}`);
const row = (await db.query("SELECT mime, size FROM images WHERE file = $1", [url.split('/').pop()])).rows[0];
rec('La photo est stockée dans la table images', row?.mime === 'image/png' && row.size === PNG.length, `${row?.size} octets`);

/* 2. Service HTTP */
const got = await raw('GET', url);
rec('Photo servie à l\'identique (empreinte SHA-256 égale à l\'original)', got.status === 200 && sha(got.body) === sha(PNG));
rec('En-têtes : image/png, nosniff, cache immuable 1 an', got.headers['content-type'] === 'image/png' && got.headers['x-content-type-options'] === 'nosniff' && /immutable/.test(got.headers['cache-control']) && /max-age=31536000/.test(got.headers['cache-control']), got.headers['cache-control']);
const cond = await raw('GET', url, { headers: { 'If-None-Match': got.headers.etag } });
rec('Requête conditionnelle → 304 sans corps', cond.status === 304 && cond.body.length === 0);

/* 3. Produit + commande gardent la photo ; survie au redémarrage = lecture directe en base */
const prod = await json('POST', '/api/admin/products', { name: 'Produit avec photo', price: 1200, stock: 5, image: url }, cookie);
const list = (await json('GET', '/api/products')).data;
rec('Le produit expose l\'URL de la photo', list.some((p) => p.image === url));

/* 4. Sécurité du chemin */
const bad = [];
for (const p of ['/uploads/..%2f..%2fpackage.json', '/uploads/../package.json', '/uploads/%2e%2e/%2e%2e/.env', '/uploads/aaaaaaaaaaaaaaaaaaaaaaaa.php', '/uploads/AAAAAAAAAAAAAAAAAAAAAAAA.png', '/uploads/%27%20OR%201=1--.png', '/uploads/' + 'a'.repeat(5000) + '.png']) {
  const r = await raw('GET', p);
  if (r.status === 200 && !r.headers['content-type']?.startsWith('text/html')) bad.push(p.slice(0, 40));
}
rec('Noms de fichiers hostiles (traversée, injection, extensions) refusés', bad.length === 0, bad.join(' | '));
const nf = await raw('GET', '/uploads/0123456789abcdef01234567.png');
rec('Photo inexistante → 404 (pas d\'erreur serveur)', nf.status === 404, `HTTP ${nf.status}`);

/* 5. Repli sur d'anciens fichiers du disque (développement) */
fs.mkdirSync('uploads', { recursive: true });
fs.writeFileSync('uploads/bbbbbbbbbbbbbbbbbbbbbbbb.png', PNG);
const legacy = await raw('GET', '/uploads/bbbbbbbbbbbbbbbbbbbbbbbb.png');
rec('Anciens fichiers du disque toujours servis (repli de compatibilité)', legacy.status === 200 && sha(legacy.body) === sha(PNG));
fs.rmSync('uploads/bbbbbbbbbbbbbbbbbbbbbbbb.png');

/* 6. Nettoyage des photos orphelines (au prochain démarrage) */
const orphan = JSON.parse((await upload(Buffer.concat([PNG, Buffer.from('x')]))).body.toString()).url.split('/').pop();
const order = await json('POST', '/api/orders', { name: 'Client Photo', phone: '0711223344', address: 'Abidjan Plateau', items: [{ id: prod.data.id, qty: 1 }] });
const orderOnly = JSON.parse((await upload(Buffer.concat([PNG, Buffer.from('yy')]))).body.toString()).url;
await db.query("UPDATE order_items SET image = $1 WHERE order_id = (SELECT id FROM orders WHERE code = $2)", [orderOnly, order.data.code]); // photo gardée seulement par l'historique de commande
await db.query("UPDATE images SET created_at = now() - interval '3 days'");
const fresh = JSON.parse((await upload(Buffer.concat([PNG, Buffer.from('zzz')]))).body.toString()).url.split('/').pop(); // récente et orpheline : doit survivre
console.log('       (redémarrage du serveur requis pour déclencher le ménage — voir la suite)');
console.log(JSON.stringify({ orphan, keptByProduct: url.split('/').pop(), keptByOrder: orderOnly.split('/').pop(), fresh }));

console.log(`\nRÉSUMÉ PARTIE 1 : ${results.filter(Boolean).length}/${results.length} vérifications réussies`);
await db.end();
process.exit(results.every(Boolean) ? 0 : 1);
