// ⚠ Ne cible QUE localhost (instance de test). Ne jamais pointer vers un serveur de production.
// Batterie de tests d'attaque — cible : instance LOCALE de test uniquement (http://localhost:3100).
import http from 'node:http';
import crypto from 'node:crypto';

const HOST = 'localhost', PORT = Number(process.env.AUDIT_PORT) || 3100, BASE = `http://${HOST}:${PORT}`;
const ADMIN = { email: 'admin@ccm-nonsaka.com', password: process.env.AUDIT_PW };
const results = [];
const ph = () => '07' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const rec = (id, name, secure, detail = '') => {
  results.push({ id, name, secure, detail });
  console.log(`${secure ? 'OK     ' : 'FAILLE '} ${id.padEnd(5)} ${name}${detail ? '  → ' + detail : ''}`);
};

/** Requête HTTP brute : le chemin est envoyé tel quel (pas de normalisation) — nécessaire pour tester les traversées. */
function raw(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: HOST, port: PORT, method, path, headers, setHost: true }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const json = (method, path, data, cookie, extra = {}) =>
  raw(method, path, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

async function login(extra = {}) {
  const r = await json('POST', '/api/admin/login', ADMIN, undefined, extra);
  const c = (r.headers['set-cookie'] || [])[0]?.split(';')[0];
  return { r, cookie: c };
}

/* ================= A. En-têtes de sécurité ================= */
{
  const r = await raw('GET', '/');
  const h = r.headers;
  const csp = h['content-security-policy'] || '';
  rec('A1', 'CSP présente et sans unsafe-inline pour les scripts', /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe/.test(csp), csp.slice(0, 90));
  rec('A2', 'CSP connect-src restreint à self', /connect-src 'self'(;|$)/.test(csp), (csp.match(/connect-src[^;]*/) || [''])[0]);
  rec('A3', 'X-Content-Type-Options: nosniff', h['x-content-type-options'] === 'nosniff');
  rec('A4', 'Anti-clickjacking (frame-ancestors / X-Frame-Options)', /frame-ancestors 'none'/.test(csp) || !!h['x-frame-options']);
  rec('A5', 'Pas de X-Powered-By', !h['x-powered-by']);
  rec('A6', 'Referrer-Policy définie', !!h['referrer-policy'], h['referrer-policy']);
  rec('A7', 'HSTS défini', !!h['strict-transport-security'], 'ignoré en HTTP, utile derrière HTTPS');
  const cors = await raw('OPTIONS', '/api/admin/products', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  rec('A8', 'Pas de CORS ouvert (aucun Access-Control-Allow-Origin)', !cors.headers['access-control-allow-origin']);
}

/* ================= B. Accès non authentifié aux routes admin ================= */
{
  const routes = [['GET', '/api/admin/me'], ['GET', '/api/admin/stats'], ['GET', '/api/admin/pulse'], ['GET', '/api/admin/products'], ['POST', '/api/admin/products'],
    ['PUT', '/api/admin/products/1'], ['PATCH', '/api/admin/products/1/stock'], ['PATCH', '/api/admin/products/1/active'], ['DELETE', '/api/admin/products/1'],
    ['POST', '/api/admin/upload'], ['GET', '/api/admin/orders'], ['PATCH', '/api/admin/orders/1/status'], ['GET', '/api/admin/push/stats'],
    ['POST', '/api/admin/push/subscribe'], ['POST', '/api/admin/push/broadcast'], ['POST', '/api/admin/password']];
  const bad = [];
  for (const [m, p] of routes) { const r = (m === 'GET' || m === 'DELETE') ? await raw(m, p) : await json(m, p, {}); if (r.status !== 401) bad.push(`${m} ${p}=${r.status}`); }
  rec('B1', `${routes.length} routes admin refusent l'accès sans session`, bad.length === 0, bad.join(', '));
}

/* ================= C. Falsification de session ================= */
{
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Date.now() + 3600e3;
  const forged = [
    ['signature aléatoire', `${b64({ id: 1, exp })}.${crypto.randomBytes(32).toString('base64url')}`],
    ['signature vide', `${b64({ id: 1, exp })}.`],
    ['sans signature', b64({ id: 1, exp })],
    ['alg none / jeton JWT factice', `${Buffer.from('{"alg":"none"}').toString('base64url')}.${b64({ id: 1, exp })}.`],
    ['signature = payload', `${b64({ id: 1, exp })}.${b64({ id: 1, exp })}`],
  ];
  const bad = [];
  for (const [n, v] of forged) { const r = await json('GET', '/api/admin/me', undefined, `adm=${v}`); if (r.status !== 401) bad.push(n); }
  rec('C1', 'Cookies de session falsifiés rejetés', bad.length === 0, bad.join(', '));

  const { cookie } = await login();
  const [sid, sig] = cookie.split('=')[1].split('.');
  const name = cookie.split('=')[0];
  const flip = (x) => x.slice(0, -1) + (x.slice(-1) === 'A' ? 'B' : 'A');
  rec('C2', "Identifiant de session modifié avec l'ancienne signature rejeté", (await json('GET', '/api/admin/me', undefined, `${name}=${flip(sid)}.${sig}`)).status === 401);
  rec('C3', 'Signature modifiée rejetée', (await json('GET', '/api/admin/me', undefined, `${name}=${sid}.${flip(sig)}`)).status === 401);
  rec('C4', 'Session valide acceptée (témoin)', (await json('GET', '/api/admin/me', undefined, cookie)).status === 200);
}

/* ================= D. Injections SQL ================= */
{
  const payloads = ["' OR '1'='1", "'; DROP TABLE orders;--", "admin@ccm-nonsaka.com' --", '" OR ""="', "1; SELECT pg_sleep(3)--"];
  let bad = [];
  for (const pl of payloads) {
    const r = await json('POST', '/api/admin/login', { email: pl, password: pl });
    if (r.status !== 401 && r.status !== 429) bad.push(`login ${pl}=${r.status}`);
  }
  const t0 = Date.now();
  for (const pl of payloads) {
    const r = await json('GET', `/api/orders/${encodeURIComponent(pl)}`);
    if (r.status !== 404) bad.push(`track=${r.status}`);
  }
  const slow = Date.now() - t0 > 2500;
  rec('D1', 'SQLi dans login et suivi de commande sans effet (pas de 500, pas de délai pg_sleep)', bad.length === 0 && !slow, bad.join(', '));

  const { cookie } = await login({ 'X-Forwarded-For': '10.9.9.9' });
  for (const q of ["1;DROP TABLE orders", "1 OR 1=1", "-1", "99999999999999999999", "abc"]) {
    const r = await json('GET', `/api/admin/orders?limit=${encodeURIComponent(q)}`, undefined, cookie);
    if (r.status !== 200) bad.push(`limit=${q}→${r.status}`);
  }
  const after = await json('GET', '/api/admin/stats', undefined, cookie);
  rec('D2', 'Paramètre limit : valeurs hostiles neutralisées, tables intactes', bad.length === 0 && after.status === 200, bad.join(', '));

  const o = await json('POST', '/api/orders', { name: "Robert'); DROP TABLE products;--", phone: ph(), address: "1' OR '1'='1 Abidjan", note: "'; UPDATE products SET price=0;--", items: [{ id: 1, qty: 1 }] });
  const prods = JSON.parse((await json('GET', '/api/products')).body);
  rec('D3', 'SQLi dans les champs de commande : stockée comme texte, prix inchangés', o.status === 201 && prods.length >= 6 && prods.every((x) => x.price > 0), `HTTP ${o.status}`);
}

/* ================= E. XSS stocké / rupture du JSON embarqué ================= */
{
  const { cookie } = await login({ 'X-Forwarded-For': '10.9.9.8' });
  const xss = '</script><script>window.__pwned=1</script><img src=x onerror=window.__pwned=2>';
  const c = await json('POST', '/api/admin/products', { name: `XSS ${xss}`, description: xss, category: xss.slice(0, 40), price: 100, stock: 5, kind: 'medicament', usage: `${xss} mode d'emploi` }, cookie);
  const html = (await raw('GET', '/')).body;
  const boot = html.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/);
  const bootOk = !!boot && !boot[1].includes('</script') && !boot[1].includes('<img');
  const afterBoot = html.slice(html.indexOf('id="boot"'));
  const injected = /<script>window\.__pwned/.test(html);
  rec('E1', 'Produit hostile : JSON embarqué dans la page ne peut pas sortir de sa balise <script>', c.status === 201 && bootOk && !injected, `création=${c.status}`);
  await json('POST', '/api/orders', { name: `<img src=x onerror=window.__pwned=3>`, phone: ph(), address: '"><script>window.__pwned=4</script>', note: xss, items: [{ id: 1, qty: 1 }] });
  console.log('       (le rendu DOM de ces données est vérifié séparément dans le navigateur)');
}

/* ================= F. Upload de fichiers ================= */
{
  const { cookie } = await login({ 'X-Forwarded-For': '10.9.9.7' });
  const up = (buf, ct = 'application/octet-stream') => raw('POST', '/api/admin/upload', { headers: { 'Content-Type': ct, Cookie: cookie, 'Content-Length': buf.length }, body: buf });
  rec('F1', 'Fichier HTML/PHP refusé', (await up(Buffer.from('<?php system($_GET[1]); ?><html><script>alert(1)</script>'))).status === 400);
  rec('F2', 'SVG avec script refusé', (await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), 'image/svg+xml')).status === 400);
  rec('F3', 'Extension/MIME mensongers ignorés (contenu testé)', (await up(Buffer.from('GIF89a<script>alert(1)</script>'), 'image/png')).status === 400);
  const poly = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('<script>alert(1)</script>')]);
  const pr = await up(poly);
  let served = { headers: {} };
  if (pr.status === 201) served = await raw('GET', JSON.parse(pr.body).url);
  rec('F4', 'Polyglotte PNG+script : servi en image/png avec nosniff (inoffensif dans un <img>)', pr.status !== 201 || (served.headers['content-type'] === 'image/png' && served.headers['x-content-type-options'] === 'nosniff'), `HTTP ${pr.status}, ${served.headers['content-type'] || ''}`);
  const big = Buffer.alloc(4 * 1024 * 1024, 0x41); big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  const br = await up(big).catch(() => ({ status: 'reset' }));
  rec('F5', 'Fichier de 4 Mo refusé (limite 3 Mo)', br.status === 413 || br.status === 'reset', String(br.status));
}

/* ================= G. Traversée de chemins / fichiers sensibles ================= */
{
  const paths = ['/../package.json', '/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/assets/../../package.json', '/uploads/../../package.json',
    '/uploads/%2e%2e/%2e%2e/package.json', '/.env', '/..%5c..%5cpackage.json', '/src/server/config.ts', '/dist/server.js', '/node_modules/express/package.json', '/%00', '/admin/../../.env'];
  const bad = [];
  for (const p of paths) {
    const r = await raw('GET', p);
    const leaks = r.status === 200 && /"name":\s*"ccm-nonsaka"|DATABASE_URL|express/.test(r.body) && !r.body.includes('<!doctype');
    if (leaks) bad.push(`${p}→${r.status}`);
  }
  rec('G1', `${paths.length} chemins de traversée / fichiers sensibles ne fuient rien`, bad.length === 0, bad.join(', '));
}

/* ================= I. CSRF : requête d'écriture venant d'un autre site ================= */
{
  const { cookie } = await login({ 'X-Forwarded-For': '10.9.9.6' });
  const r = await json('POST', '/api/admin/push/broadcast', { title: '', body: '' }, cookie, { Origin: 'https://evil.example' });
  rec('I1', "Écriture admin refusée si l'en-tête Origin vient d'un autre site (défense en profondeur)", r.status === 403, `HTTP ${r.status}`);
  const ct = await raw('POST', '/api/admin/products', { headers: { 'Content-Type': 'text/plain', Cookie: cookie }, body: JSON.stringify({ name: 'csrf', price: 1, stock: 1 }) });
  rec('I2', 'Corps text/plain (formulaire cross-site) non interprété comme JSON', ct.status === 400 || ct.status === 403, `HTTP ${ct.status}`);
}

/* ================= J. Abus de la logique de commande ================= */
{
  const base = { name: 'Testeur', phone: ph(), address: 'Abidjan Plateau', items: [{ id: 1, qty: 1 }] };
  const cases = [
    ['quantité négative', { items: [{ id: 1, qty: -5 }] }], ['quantité 0', { items: [{ id: 1, qty: 0 }] }], ['quantité 100', { items: [{ id: 1, qty: 100 }] }],
    ['quantité décimale', { items: [{ id: 1, qty: 1.5 }] }], ['quantité 1e3', { items: [{ id: 1, qty: '1e3' }] }], ['id inexistant', { items: [{ id: 99999, qty: 1 }] }],
    ['id négatif', { items: [{ id: -1, qty: 1 }] }], ['51 lignes', { items: Array.from({ length: 51 }, () => ({ id: 1, qty: 1 })) }],
    ['items non tableau', { items: 'x' }], ['téléphone invalide', { phone: 'abc' }], ['nom vide', { name: '' }], ['quantités cumulées > stock', { items: [{ id: 1, qty: 99 }, { id: 1, qty: 99 }] }],
  ];
  const bad = [];
  for (const [n, patch] of cases) {
    const r = await json('POST', '/api/orders', { ...base, ...patch }, undefined, { 'X-Forwarded-For': `10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
    if (r.status < 400 || r.status >= 500) bad.push(`${n}=${r.status}`);
  }
  rec('J1', 'Commandes aberrantes toutes refusées (4xx, jamais 201/500)', bad.length === 0, bad.join(', '));

  const prods = JSON.parse((await json('GET', '/api/products')).body);
  const p = prods.find((x) => x.stock > 2 && x.kind === 'produit');
  const r = await json('POST', '/api/orders', { ...base, items: [{ id: p.id, qty: 1, price: 1 }], total: 1 }, undefined, { 'X-Forwarded-For': '10.2.2.2' });
  rec('J2', 'Prix/total envoyés par le client ignorés (calcul côté serveur)', r.status === 201 && JSON.parse(r.body).total === p.price, `total=${JSON.parse(r.body).total} attendu=${p.price}`);
}

{
  const same = ph();
  const out = [];
  for (let i = 0; i < 5; i++) out.push((await json('POST', '/api/orders', { name: 'Accapareur', phone: same, address: 'Abidjan Plateau', items: [{ id: 1, qty: 1 }] }, undefined, { 'X-Forwarded-For': `10.7.${i}.1` })).status);
  rec('J3', "Accaparement du stock : au plus 3 commandes en attente par numéro de téléphone", out.filter((x) => x === 201).length === 3 && out[3] === 429, out.join(','));
}

/* ================= K. Survente de stock (concurrence) ================= */
{
  const { cookie } = await login({ 'X-Forwarded-For': '10.9.9.5' });
  const c = await json('POST', '/api/admin/products', { name: 'Stock rare', price: 500, stock: 3 }, cookie);
  const id = JSON.parse(c.body).id;
  const reqs = Array.from({ length: 12 }, (_, i) => json('POST', '/api/orders', { name: 'Course', phone: ph(), address: 'Abidjan Plateau', items: [{ id, qty: 1 }] }, undefined, { 'X-Forwarded-For': `10.3.${i}.1` }));
  const out = await Promise.all(reqs);
  const ok = out.filter((r) => r.status === 201).length;
  const stock = JSON.parse((await json('GET', '/api/admin/products', undefined, cookie)).body).find((x) => x.id === id).stock;
  rec('K1', '12 commandes simultanées pour 3 unités : exactement 3 acceptées, stock jamais négatif', ok === 3 && stock === 0, `acceptées=${ok}, stock final=${stock}`);
}

console.log('\nRÉSUMÉ PHASE 1 :', results.filter((r) => r.secure).length, 'OK /', results.filter((r) => !r.secure).length, 'failles');
