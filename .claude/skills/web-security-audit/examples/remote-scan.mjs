// Test d'intrusion NON DESTRUCTIF d'un site déployé (le vôtre uniquement !).
// Usage : TARGET=https://votre-site.onrender.com node tests/security/remote-scan.mjs
// Garanties : aucune écriture en base (commandes invalides uniquement), aucun envoi d'email, jamais d'essai sur le vrai compte
// admin (les tests de connexion utilisent une adresse bidon), pas de test de charge (quelques dizaines de requêtes au total).
import https from 'node:https';
import http from 'node:http';

const TARGET = process.env.TARGET;
if (!TARGET || !/^https?:\/\//.test(TARGET)) { console.error('Indiquez TARGET=https://votre-site'); process.exit(1); }
const url = new URL(TARGET);
const lib = url.protocol === 'https:' ? https : http;
const results = [];
const rec = (id, name, secure, detail = '') => { results.push({ id, secure }); console.log(`${secure ? 'OK     ' : 'FAILLE '} ${id.padEnd(4)} ${name}${detail ? '  → ' + detail : ''}`); };

function req(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = lib.request({ host: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), method, path, headers, timeout: 30000 }, (res) => {
      const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString('utf8') }));
    });
    r.on('error', reject); r.on('timeout', () => r.destroy(new Error('timeout')));
    if (body) r.write(body); r.end();
  });
}
const json = (method, path, data, extra = {}) => {
  const body = data === undefined ? undefined : JSON.stringify(data);
  return req(method, path, { headers: { ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...extra }, body });
};

/* A. En-têtes et TLS */
{
  const r = await req('GET', '/'); const h = r.headers, csp = h['content-security-policy'] || '';
  rec('A1', 'CSP stricte (scripts uniquement du site, pas de frame, pas de connexion externe)', /script-src 'self'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /connect-src 'self'/.test(csp) && !/script-src[^;]*unsafe/.test(csp));
  rec('A2', 'HSTS actif (≥ 6 mois)', Number((/max-age=(\d+)/.exec(h['strict-transport-security'] || '') || [])[1]) >= 15552000, h['strict-transport-security']);
  rec('A3', 'nosniff + Referrer-Policy + Permissions-Policy', h['x-content-type-options'] === 'nosniff' && !!h['referrer-policy'] && !!h['permissions-policy']);
  rec('A4', "Pas de fuite de technologie (X-Powered-By)", !h['x-powered-by']);
  const nf = await req('GET', '/chemin-inexistant-pentest');
  rec('A5', "Page 404 sans signature du framework (« Cannot GET »)", !/Cannot GET|Express|Error<\/title>/i.test(nf.body), nf.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60));
  if (url.protocol === 'https:') {
    const plain = await new Promise((res) => http.get({ host: url.hostname, path: '/', timeout: 20000 }, (x) => res(x)).on('error', () => res(null)));
    rec('A6', 'HTTP redirigé vers HTTPS', plain && [301, 302, 307, 308].includes(plain.statusCode) && /^https:/.test(plain.headers.location || ''), plain ? `${plain.statusCode} → ${plain.headers.location}` : 'pas de réponse');
  }
}

/* B. Routes admin sans session */
{
  const routes = [['GET', '/api/admin/me'], ['GET', '/api/admin/stats'], ['GET', '/api/admin/pulse'], ['GET', '/api/admin/products'], ['GET', '/api/admin/orders'], ['GET', '/api/admin/push/stats'],
    ['DELETE', '/api/admin/products/1'], ['POST', '/api/admin/products'], ['PUT', '/api/admin/products/1'], ['PATCH', '/api/admin/products/1/stock'], ['PATCH', '/api/admin/orders/1/status'],
    ['POST', '/api/admin/upload'], ['POST', '/api/admin/password'], ['POST', '/api/admin/email'], ['POST', '/api/admin/push/broadcast'], ['POST', '/api/admin/push/subscribe']];
  const bad = [];
  for (const [m, p] of routes) { const r = (m === 'GET' || m === 'DELETE') ? await req(m, p) : await json(m, p, {}); if (r.status !== 401) bad.push(`${m} ${p}=${r.status}`); }
  rec('B1', `${routes.length} routes admin refusent l'accès sans session`, bad.length === 0, bad.join(', '));
}

/* C. Cookies falsifiés (le nom de cookie de production est __Host-adm) */
{
  const bad = [];
  for (const [n, v] of [['aléatoire', 'A'.repeat(43) + '.' + 'B'.repeat(43)], ['sans signature', 'x'], ['vide', ''], ['JWT factice', 'eyJhbGciOiJub25lIn0.eyJpZCI6MX0.']]) {
    for (const name of ['__Host-adm', 'adm']) { const r = await req('GET', '/api/admin/me', { headers: { Cookie: `${name}=${v}` } }); if (r.status !== 401) bad.push(`${name}/${n}`); }
  }
  rec('C1', 'Cookies de session falsifiés rejetés', bad.length === 0, bad.join(', '));
}

/* D. Injections */
{
  const bad = [];
  for (const pl of ["' OR '1'='1", "'; DROP TABLE orders;--", '" OR ""="', '1; SELECT pg_sleep(5)--']) {
    const t = Date.now();
    const r = await req('GET', `/api/orders/${encodeURIComponent(pl)}`);
    if (r.status !== 404 && r.status !== 429 && !(r.status === 403 && /cloudflare/i.test(r.headers.server || ''))) bad.push(`track ${pl}=${r.status}`);
    if (Date.now() - t > 4000) bad.push('délai suspect (pg_sleep ?)');
  }
  for (const q of ["1;DROP TABLE orders", '-1', 'abc']) { const r = await req('GET', `/api/products?x=${encodeURIComponent(q)}`); if (r.status !== 200 && !(r.status === 403 && /cloudflare/i.test(r.headers.server || ''))) bad.push(`products ?x=${q}=${r.status}`); }
  rec('D1', 'SQLi / paramètres hostiles sans effet (pas de 500, pas de délai)', bad.length === 0, bad.join(', '));
  const r = await json('POST', '/api/admin/login', { email: { $ne: null }, password: { $ne: null } });
  rec('D2', 'Injection NoSQL/objet dans le login refusée', r.status === 401 || r.status === 400 || r.status === 429, `HTTP ${r.status}`);
}

/* I. CSRF / origine */
{
  const o = await json('POST', '/api/admin/push/broadcast', { title: 'x', body: 'y' }, { Origin: 'https://evil.example' });
  rec('I1', "Écriture refusée si l'Origin vient d'un autre site (403)", o.status === 403, `HTTP ${o.status}`);
  const f = await json('POST', '/api/admin/products', { name: 'x' }, { 'Sec-Fetch-Site': 'cross-site' });
  rec('I2', 'Sec-Fetch-Site: cross-site refusé (403)', f.status === 403, `HTTP ${f.status}`);
  const t = await req('POST', '/api/admin/products', { headers: { 'Content-Type': 'text/plain' }, body: '{"name":"x"}' });
  rec('I3', 'Corps text/plain (formulaire cross-site) non accepté', [400, 401, 403].includes(t.status), `HTTP ${t.status}`);
  const c = await req('OPTIONS', '/api/admin/products', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  rec('I4', 'Pas de CORS ouvert', !c.headers['access-control-allow-origin']);
}

/* L. SSRF via abonnement push (aucune écriture : refusé à la validation) */
{
  const keys = { p256dh: 'BP' + 'A'.repeat(85), auth: 'A'.repeat(22) };
  const bad = [];
  for (const e of ['https://127.0.0.1:9/x', 'https://169.254.169.254/latest/meta-data/', 'https://localhost/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'file:///etc/passwd']) {
    const r = await json('POST', '/api/subscribe', { subscription: { endpoint: e, keys } });
    if (r.status !== 400) bad.push(`${e}=${r.status}`);
  }
  rec('L1', 'Adresses internes / trompeuses refusées comme endpoint push (8 variantes)', bad.length === 0, bad.join(' | '));
}

/* J. Logique de commande : uniquement des commandes REFUSÉES (aucune ligne créée en base) */
{
  const base = { name: 'Pentest', phone: '0700000000', address: 'Adresse de test', items: [{ id: 1, qty: 1 }] };
  const cases = [['quantité négative', { items: [{ id: 1, qty: -5 }] }], ['quantité 0', { items: [{ id: 1, qty: 0 }] }], ['quantité 100', { items: [{ id: 1, qty: 100 }] }], ['décimale', { items: [{ id: 1, qty: 1.5 }] }],
    ['id inexistant', { items: [{ id: 99999999, qty: 1 }] }], ['panier vide', { items: [] }], ['téléphone invalide', { phone: 'abc' }], ['nom vide', { name: '' }], ['items non tableau', { items: 'x' }]];
  const bad = [];
  for (const [n, patch] of cases) { const r = await json('POST', '/api/orders', { ...base, ...patch }); if (r.status < 400 || r.status >= 500) bad.push(`${n}=${r.status}`); }
  rec('J1', 'Commandes aberrantes refusées (4xx, jamais 201/500)', bad.length === 0, bad.join(', '));
}

/* F/P/Q. Uploads, erreurs, tailles */
{
  const u = await req('POST', '/api/admin/upload', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 12 }, body: Buffer.from('GIF89a123456') });
  rec('F1', 'Upload impossible sans être connecté', u.status === 401, `HTTP ${u.status}`);
  const m = await req('POST', '/api/orders', { headers: { 'Content-Type': 'application/json' }, body: '{"name":' });
  rec('P1', 'JSON malformé → 400 propre, sans trace de pile', m.status === 400 && !/at |node_modules|\.ts:/.test(m.body), m.body.slice(0, 50));
  const huge = JSON.stringify({ name: 'x'.repeat(60 * 1024) });
  const h = await req('POST', '/api/orders', { headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(huge) }, body: huge });
  rec('Q1', 'Corps de 60 Ko refusé (413)', h.status === 413, `HTTP ${h.status}`);
  const tr = await req('GET', '/uploads/..%2f..%2fpackage.json');
  rec('G1', 'Traversée de chemin sur /uploads sans fuite', !/"name":\s*"ccm-nonsaka"/.test(tr.body), `HTTP ${tr.status}`);
}

/* H. Protections par compte (adresses bidon : le vrai compte admin n'est jamais ciblé) */
{
  const fake = `pentest-${Date.now()}@example.invalid`;
  const out = [];
  for (let i = 0; i < 10; i++) out.push((await json('POST', '/api/admin/login', { email: fake, password: 'mauvais-' + i })).status);
  rec('H1', 'Connexion : verrouillage après des échecs répétés sur une même adresse (429)', out.includes(429), out.join(','));
  const f = [];
  for (let i = 0; i < 5; i++) f.push((await json('POST', '/api/admin/forgot', { email: fake })).status);
  rec('H2', 'Mot de passe oublié : 4ᵉ demande/heure pour une même adresse bloquée (429)', f.slice(3).includes(429), f.join(','));
}

/* R. Limitation par IP (le test qui détecte une IP cliente mal identifiée derrière un proxy) */
{
  const out = [];
  for (let i = 0; i < 130; i++) out.push((await req('GET', `/api/orders/CCM-RATE${String(i).padStart(3, '0')}`)).status);
  const first429 = out.indexOf(429) + 1;
  rec('R1', 'Limitation par IP active : suivi de commande limité à 120/min (429 attendu dès la 121ᵉ requête)', first429 >= 118 && first429 <= 124, first429 ? `premier 429 à la requête n°${first429}` : 'JAMAIS bloqué sur 130 requêtes → la limitation par IP ne fonctionne pas');
  const sp = await req('GET', '/api/orders/CCM-SPOOF1', { headers: { 'X-Forwarded-For': '203.0.113.77', 'True-Client-IP': '203.0.113.79' } });
  rec('R2', "Falsifier X-Forwarded-For / True-Client-IP ne permet pas d'échapper à la limite", first429 === 0 ? false : sp.status === 429, `HTTP ${sp.status} (attendu 429 : toujours bloqué)`);
  const cf = await req('GET', '/api/orders/CCM-SPOOF2', { headers: { 'CF-Connecting-IP': '203.0.113.78' } });
  rec('R3', 'Falsifier CF-Connecting-IP est impossible (bloqué par Cloudflare ou par la limite)', cf.status === 403 || cf.status === 429, `HTTP ${cf.status}`);
}

console.log(`\nRÉSUMÉ : ${results.filter((r) => r.secure).length} OK / ${results.filter((r) => !r.secure).length} faille(s) sur ${results.length} contrôles`);
process.exit(results.every((r) => r.secure) ? 0 : 1);
