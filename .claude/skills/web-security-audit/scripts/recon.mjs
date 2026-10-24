// Reconnaissance NON DESTRUCTIVE d'un site déployé (le vôtre uniquement) : TLS, HTTPS, en-têtes, cookies, CORS, 404, fichiers sensibles.
// Usage : TARGET=https://votre-site.example node recon.mjs
// ~60 requêtes GET/OPTIONS, aucune écriture.
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';

const TARGET = process.env.TARGET;
if (!TARGET || !/^https?:\/\//.test(TARGET)) { console.error('Indiquez TARGET=https://votre-site'); process.exit(1); }
const url = new URL(TARGET), secure = url.protocol === 'https:', lib = secure ? https : http;
let bad = 0;
const rec = (ok, name, detail = '') => { if (!ok) bad++; console.log(`${ok ? 'OK     ' : 'FAILLE '} ${name}${detail ? '  → ' + detail : ''}`); };
const info = (name, detail) => console.log(`INFO   ${name}${detail ? '  → ' + detail : ''}`);

const get = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve) => {
  const r = lib.request({ host: url.hostname, port: url.port || (secure ? 443 : 80), method, path, headers, timeout: 25000 }, (res) => {
    const c = []; res.on('data', (d) => c.length < 40 && c.push(d)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString('utf8').slice(0, 4000) }));
  });
  r.on('error', (e) => resolve({ status: 0, headers: {}, body: '', error: e.code })); r.on('timeout', () => r.destroy());
  r.end();
});

/* TLS : versions acceptées */
if (secure) {
  const probe = (v) => new Promise((res) => {
    const s = tls.connect({ host: url.hostname, port: url.port || 443, servername: url.hostname, minVersion: v, maxVersion: v, timeout: 15000 }, () => { s.end(); res(true); });
    s.on('error', () => res(false)); s.on('timeout', () => { s.destroy(); res(false); });
  });
  const v10 = await probe('TLSv1'), v11 = await probe('TLSv1.1'), v12 = await probe('TLSv1.2'), v13 = await probe('TLSv1.3');
  rec(!v10 && !v11, 'TLS 1.0 / 1.1 refusés', `TLS1.0=${v10 ? 'accepté' : 'refusé'}, TLS1.1=${v11 ? 'accepté' : 'refusé'}`);
  rec(v12 || v13, 'TLS 1.2 ou 1.3 disponible', `1.2=${v12}, 1.3=${v13}`);
  const plain = await new Promise((res) => http.get({ host: url.hostname, path: '/', timeout: 20000 }, (x) => { x.resume(); res(x); }).on('error', () => res(null)));
  rec(!!plain && [301, 302, 307, 308].includes(plain.statusCode) && /^https:/.test(plain.headers.location || ''), 'HTTP redirigé vers HTTPS', plain ? `${plain.statusCode} → ${plain.headers.location}` : 'pas de réponse HTTP');
} else info('TLS', 'cible en HTTP : test ignoré');

/* En-têtes */
const home = await get('/');
const h = home.headers, csp = h['content-security-policy'] || '';
info('Serveur', `${h.server || '?'} | statut ${home.status}`);
rec(!!csp, 'Content-Security-Policy présente');
if (csp) {
  rec(!/script-src[^;]*'unsafe-(inline|eval)'/.test(csp) && /(script-src|default-src)/.test(csp), 'CSP : pas de unsafe-inline/unsafe-eval pour les scripts');
  rec(/frame-ancestors/.test(csp) || !!h['x-frame-options'], 'Anti-clickjacking (frame-ancestors / X-Frame-Options)');
  rec(/object-src 'none'|default-src 'none'/.test(csp), "CSP : object-src 'none'");
  rec(!/connect-src[^;]*(https:|\*)/.test(csp), 'CSP : connect-src non ouvert à tout https/*');
}
if (secure) rec(Number((/max-age=(\d+)/.exec(h['strict-transport-security'] || '') || [])[1]) >= 15552000, 'HSTS ≥ 6 mois', h['strict-transport-security'] || 'absent');
rec(h['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff');
rec(!!h['referrer-policy'], 'Referrer-Policy définie', h['referrer-policy']);
rec(!!h['permissions-policy'], 'Permissions-Policy définie');
rec(!h['x-powered-by'], 'Pas de X-Powered-By', h['x-powered-by'] || '');

/* Cookies posés par la page d'accueil */
const sc = [].concat(h['set-cookie'] || []);
if (sc.length) for (const c of sc) rec(/httponly/i.test(c) && (!secure || /secure/i.test(c)) && /samesite=(strict|lax)/i.test(c), `Cookie ${c.split('=')[0]} : HttpOnly + Secure + SameSite`);
else info('Cookies', "aucun cookie posé sur la page d'accueil");

/* CORS */
const cors = await get('/', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
rec(!cors.headers['access-control-allow-origin'], 'Pas de CORS ouvert (préflight depuis une origine étrangère)', cors.headers['access-control-allow-origin'] || '');
const tr = await get('/', { method: 'TRACE' });
rec(tr.status !== 200, 'Méthode TRACE non acceptée', `HTTP ${tr.status}`);

/* 404 sans signature */
const nf = await get('/chemin-inexistant-recon-' + Date.now());
rec(!/Cannot (GET|POST)|Express|Werkzeug|Whitelabel|Tomcat|nginx\/|Apache\//i.test(nf.body), 'Page 404 sans signature du framework/serveur', nf.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60));

/* Fichiers sensibles */
const PATHS = ['/.env', '/.env.production', '/.env.local', '/.git/config', '/.git/HEAD', '/.gitignore', '/package.json', '/package-lock.json', '/yarn.lock', '/composer.json',
  '/docker-compose.yml', '/Dockerfile', '/render.yaml', '/vercel.json', '/netlify.toml', '/Procfile', '/README.md', '/DEPLOY.md', '/SECURITY-AUDIT.md',
  '/dist/server.js', '/build/index.js', '/src/index.ts', '/src/server/config.ts', '/node_modules/.package-lock.json', '/tsconfig.json', '/scripts/build.ts',
  '/assets/app.js.map', '/assets/shop.js.map', '/assets/main.js.map', '/sw.js.map', '/server.js', '/app.js', '/config.php', '/wp-config.php', '/phpinfo.php', '/database.sql', '/backup.sql', '/dump.sql',
  '/admin/.env', '/api/.env', '/uploads/../.env', '/%2e%2e/.env', '/..%2f..%2f.env', '/.DS_Store', '/id_rsa', '/.ssh/id_rsa', '/server-status', '/actuator/env', '/debug', '/api/debug', '/swagger.json', '/openapi.json'];
const leaks = [];
for (const p of PATHS) {
  const r = await get(p);
  const looksReal = r.status === 200 && !/^\s*<!doctype html|<html/i.test(r.body) ? true : false; // un 200 non-HTML = fichier réel probable
  const secretish = r.status === 200 && /(DATABASE_URL|PASSWORD|SECRET|PRIVATE KEY|"dependencies"|\[core\]|ref: refs\/)/i.test(r.body);
  if (looksReal || secretish) leaks.push(`${p} → ${r.status} ${r.headers['content-type'] || ''}`);
}
rec(leaks.length === 0, `${PATHS.length} chemins sensibles ne fuient aucun fichier`, leaks.join(' | '));

console.log(`\nRÉSUMÉ : ${bad === 0 ? 'aucune faille détectée' : bad + ' point(s) à corriger'}`);
process.exit(bad === 0 ? 0 : 1);
