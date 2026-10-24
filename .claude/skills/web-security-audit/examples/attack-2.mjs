// ⚠ Ne cible QUE localhost (instance de test). Ne jamais pointer vers un serveur de production.
// Phase 2 : limitation de débit, SSRF, sessions, erreurs — cible : instance LOCALE de test uniquement.
import http from 'node:http';

const HOST = 'localhost', PORT = Number(process.env.AUDIT_PORT) || 3100;
const ADMIN = { email: 'admin@ccm-nonsaka.com', password: process.env.AUDIT_PW };
const results = [];
const rec = (id, name, secure, detail = '') => {
  results.push({ id, name, secure });
  console.log(`${secure ? 'OK     ' : 'FAILLE '} ${id.padEnd(5)} ${name}${detail ? '  → ' + detail : ''}`);
};
function raw(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: HOST, port: PORT, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const json = (method, path, data, cookie, extra = {}) => {
  const body = data === undefined ? undefined : JSON.stringify(data);
  return raw(method, path, { headers: { ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra }, body });
};
const ck = (r) => (r.headers['set-cookie'] || [])[0]?.split(';')[0];
const ip = (n) => ({ 'X-Forwarded-For': `172.16.${Math.floor(n / 250)}.${n % 250}` });

/* B1 (corrigé : GET/DELETE sans corps) */
{
  const routes = [['GET', '/api/admin/me'], ['GET', '/api/admin/stats'], ['GET', '/api/admin/pulse'], ['GET', '/api/admin/products'], ['DELETE', '/api/admin/products/1'],
    ['GET', '/api/admin/orders'], ['GET', '/api/admin/push/stats']];
  const bad = [];
  for (const [m, p] of routes) { const r = await raw(m, p); if (r.status !== 401) bad.push(`${m} ${p}=${r.status}`); }
  rec('B1', 'Routes admin GET/DELETE sans session → 401', bad.length === 0, bad.join(', '));
}

/* L/M. Abonnements push : SSRF et inondation */
{
  const keys = { p256dh: 'BP' + 'A'.repeat(85), auth: 'A'.repeat(22) };
  const internal = await json('POST', '/api/subscribe', { subscription: { endpoint: 'https://127.0.0.1:9/internal-admin', keys } }, undefined, ip(2000));
  rec('L1', "Endpoint push interne/arbitraire refusé (SSRF : le serveur n'appelle que de vrais services push)", internal.status === 400, `HTTP ${internal.status}`);
  const meta = await json('POST', '/api/subscribe', { subscription: { endpoint: 'https://169.254.169.254/latest/meta-data/', keys } }, undefined, ip(2001));
  rec('L2', 'Adresse metadata cloud (169.254.169.254) refusée', meta.status === 400, `HTTP ${meta.status}`);
  const evil = await json('POST', '/api/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com.evil.example/x', keys } }, undefined, ip(2002));
  rec('L3', 'Faux domaine ressemblant à un service push refusé', evil.status === 400, `HTTP ${evil.status}`);
  const good = await json('POST', '/api/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys } }, undefined, ip(2003));
  rec('L4', 'Vrai endpoint Chrome (fcm.googleapis.com) toujours accepté', good.status === 200, `HTTP ${good.status}`);

  let accepted = 0;
  for (let i = 0; i < 70; i++) {
    const r = await json('POST', '/api/subscribe', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/flood${i}`, keys } }, undefined, { 'X-Forwarded-For': '172.31.0.1' });
    if (r.status === 200) accepted++;
  }
  rec('M1', "Inscriptions push limitées par IP (60/heure : pas d'inondation de la base)", accepted >= 55 && accepted <= 62, `${accepted}/70 acceptées depuis une IP`);
}

/* N. Énumération des codes de commande */
{
  let ok = 0;
  for (let i = 0; i < 150; i++) { const r = await json('GET', `/api/orders/CCM-AAAA${String(i).padStart(2, '0')}`, undefined, undefined, { 'X-Forwarded-For': '172.31.0.2' }); if (r.status === 404) ok++; }
  rec('N1', 'Suivi de commande limité en débit (120/min : anti-énumération des codes)', ok >= 115 && ok <= 125, `${ok}/150 requêtes traitées depuis une IP`);
}

/* O. Cycle de vie des sessions */
{
  const a = await json('POST', '/api/admin/login', ADMIN, undefined, ip(3000)); const cookieA = ck(a);
  const b = await json('POST', '/api/admin/login', ADMIN, undefined, ip(3001)); const cookieB = ck(b);
  await json('POST', '/api/admin/logout', {}, cookieA);
  rec('O1', 'Après déconnexion, le jeton copié est refusé (révocation côté serveur)', (await json('GET', '/api/admin/me', undefined, cookieA)).status === 401);
  const c = await json('POST', '/api/admin/login', ADMIN, undefined, ip(3003)); const cookieC = ck(c);
  const chg = await json('POST', '/api/admin/password', { current: ADMIN.password, next: ADMIN.password }, cookieB);
  const other = await json('GET', '/api/admin/me', undefined, cookieC);
  const self = await json('GET', '/api/admin/me', undefined, cookieB);
  rec('O2', "Après changement de mot de passe, les AUTRES sessions sont révoquées (la session courante reste ouverte)", chg.status === 200 && other.status === 401 && self.status === 200, `changement=${chg.status}, autre session=${other.status}, session courante=${self.status}`);
  const weak = await json('POST', '/api/admin/password', { current: ADMIN.password, next: 'court' }, ck(await json('POST', '/api/admin/login', ADMIN, undefined, ip(3002))));
  rec('O3', 'Mot de passe faible refusé', weak.status === 400, `HTTP ${weak.status}`);
}

/* P/Q. Gestion d'erreurs et limites de taille */
{
  const m = await raw('POST', '/api/orders', { headers: { 'Content-Type': 'application/json', ...ip(4000) }, body: '{"name":' });
  rec('P1', 'JSON malformé → 400 propre sans trace de pile', m.status === 400 && !/at |node_modules|\.ts/.test(m.body), m.body.slice(0, 60));
  const nf = await raw('GET', '/api/n-existe-pas');
  rec('P2', 'Route inconnue → 404 JSON générique', nf.status === 404 && !/Cannot GET/.test(nf.body), nf.body.slice(0, 60));
  const huge = JSON.stringify({ name: 'x'.repeat(60 * 1024), phone: '0102030405', address: 'Abidjan', items: [{ id: 1, qty: 1 }] });
  const h = await raw('POST', '/api/orders', { headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(huge), ...ip(4001) }, body: huge });
  rec('Q1', 'Corps JSON de 60 Ko refusé (413)', h.status === 413, `HTTP ${h.status}`);
  const deep = '['.repeat(5000) + ']'.repeat(5000);
  const d = await raw('POST', '/api/orders', { headers: { 'Content-Type': 'application/json', ...ip(4002) }, body: deep });
  rec('Q2', 'JSON profondément imbriqué sans crash serveur', d.status < 500, `HTTP ${d.status}`);
  const alive = await raw('GET', '/api/products');
  rec('Q3', 'Serveur toujours vivant après les attaques', alive.status === 200);
}

/* H. Force brute : limitation par IP, contournable par X-Forwarded-For ? */
{
  let blocked = 0;
  for (let i = 0; i < 12; i++) { const r = await json('POST', '/api/admin/login', { email: ADMIN.email, password: 'mauvais' + i }, undefined, ip(900)); if (r.status === 429) blocked++; }
  rec('H1', 'Blocage après des échecs répétés (verrou par compte à 8, par IP à 10)', blocked >= 2, `${blocked}/12 requêtes bloquées`);

  let passed = 0;
  for (let i = 0; i < 30; i++) { const r = await json('POST', '/api/admin/login', { email: ADMIN.email, password: 'devine' + i }, undefined, ip(1000 + i)); if (r.status === 401) passed++; }
  rec('H2', "Force brute impossible en falsifiant X-Forwarded-For (limitation aussi par compte)", passed <= 6, `${passed}/30 tentatives réellement évaluées avec 30 fausses IP`);
}


console.log('\nRÉSUMÉ PHASE 2 :', results.filter((r) => r.secure).length, 'OK /', results.filter((r) => !r.secure).length, 'failles');
