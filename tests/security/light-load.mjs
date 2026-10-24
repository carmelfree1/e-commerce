// Test de charge LÉGER et en LECTURE SEULE d'un site déployé (le vôtre uniquement). Ce n'est PAS un test de déni de service.
// Usage : TARGET=https://votre-site.onrender.com node tests/security/light-load.mjs
// Plafonds : 4 requêtes simultanées max, ≤ 320 requêtes au total, pause entre requêtes, arrêt automatique au premier signe de souffrance.
import https from 'node:https';
import http from 'node:http';

const T = process.env.TARGET;
if (!T || !/^https?:\/\//.test(T)) { console.error('Indiquez TARGET=https://votre-site'); process.exit(1); }
const u = new URL(T), lib = u.protocol === 'https:' ? https : http;
const WORKERS = 4, PER_WORKER = 80, PAUSE_MS = 250;
const PATHS = ['/', '/api/products', '/healthz', '/assets/shop.js', '/css/style.css', '/icons/logo.webp', '/admin/login.html'];

const lat = [], codes = {}, perPath = {};
let abort = false, done = 0;
const one = (path) => new Promise((resolve) => {
  const t = process.hrtime.bigint();
  const r = lib.get({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path, headers: { 'Accept-Encoding': 'gzip' }, timeout: 30000 }, (res) => {
    let bytes = 0; res.on('data', (d) => (bytes += d.length));
    res.on('end', () => resolve({ path, status: res.statusCode, ms: Number(process.hrtime.bigint() - t) / 1e6, bytes }));
  });
  r.on('error', () => resolve({ path, status: 0, ms: Number(process.hrtime.bigint() - t) / 1e6, bytes: 0 }));
  r.on('timeout', () => r.destroy());
});
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

const t0 = Date.now();
await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  for (let i = 0; i < PER_WORKER && !abort; i++) {
    const r = await one(PATHS[(i + w) % PATHS.length]);
    lat.push(r.ms); done++; codes[r.status] = (codes[r.status] || 0) + 1; (perPath[r.path] ||= []).push(r.ms);
    const bad = (codes[0] || 0) + (codes[500] || 0) + (codes[502] || 0) + (codes[503] || 0) + (codes[429] || 0);
    if (done >= 20 && bad / done > 0.15) { abort = true; console.log('⚠ arrêt automatique : trop d\'erreurs, on ne charge pas davantage.'); }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}));
const secs = (Date.now() - t0) / 1000;
console.log(`${done} requêtes en ${secs.toFixed(1)} s (${(done / secs).toFixed(1)} req/s, ${WORKERS} en parallèle)`);
console.log('codes HTTP :', JSON.stringify(codes));
console.log(`latence globale : médiane ${pct(lat, 50).toFixed(0)} ms | p95 ${pct(lat, 95).toFixed(0)} ms | max ${Math.max(...lat).toFixed(0)} ms`);
for (const [p, a] of Object.entries(perPath)) console.log(`  ${p.padEnd(26)} médiane ${pct(a, 50).toFixed(0).padStart(4)} ms | p95 ${pct(a, 95).toFixed(0).padStart(4)} ms | n=${a.length}`);
const h = await one('/healthz');
console.log(`santé après le test : /healthz → ${h.status} en ${h.ms.toFixed(0)} ms`);
const errors = (codes[0] || 0) + (codes[500] || 0) + (codes[502] || 0) + (codes[503] || 0);
console.log(errors === 0 && h.status === 200 ? 'RÉSULTAT : aucune erreur, le site tient cette charge.' : `RÉSULTAT : ${errors} erreur(s) à examiner.`);
