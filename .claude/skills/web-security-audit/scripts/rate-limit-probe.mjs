// La limitation de débit PAR IP fonctionne-t-elle derrière le proxy/CDN réel ? (piège n°1 des déploiements PaaS)
// Usage : TARGET=https://votre-site RATE_PATH=/api/orders/CCM-TEST00 LIMIT=30 node rate-limit-probe.mjs
//   RATE_PATH : une route PUBLIQUE en lecture seule soumise à une limite par IP ; LIMIT : le seuil attendu par minute.
// Envoie N = LIMIT + 10 requêtes (≈ 40) puis 3 requêtes avec des en-têtes d'IP falsifiés. Aucune écriture.
import https from 'node:https';
import http from 'node:http';

// Git Bash (Windows) réécrit les valeurs qui ressemblent à un chemin Unix (« /api/x » devient « C:/Program Files/Git/api/x ») : on le répare.
const fixPath = (p) => { const m = /^[A-Za-z]:[\/].*?[\/]Git(\/.*)$/.exec(p); return m ? m[1] : p; };
const TARGET = process.env.TARGET, RATE_PATH = fixPath(process.env.RATE_PATH || ''), LIMIT = Number(process.env.LIMIT || 30);
if (RATE_PATH && !/^\/\S*$/.test(RATE_PATH)) { console.error(`RATE_PATH invalide : « ${RATE_PATH} » (doit commencer par / et ne pas contenir d'espace). Sous Git Bash, préfixez la commande par MSYS_NO_PATHCONV=1.`); process.exit(1); }
if (!TARGET || !RATE_PATH) { console.error('Indiquez TARGET=https://site et RATE_PATH=/route/publique (soumise à une limite par IP)'); process.exit(1); }
const u = new URL(TARGET), lib = u.protocol === 'https:' ? https : http;
const call = (headers = {}) => new Promise((res) => {
  const r = lib.get({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: RATE_PATH, headers, timeout: 25000 }, (x) => { x.resume(); x.on('end', () => res({ s: x.statusCode, server: x.headers.server || '' })); });
  r.on('error', () => res({ s: 0 })); r.on('timeout', () => r.destroy());
});

const N = LIMIT + 10, codes = [];
for (let i = 0; i < N; i++) codes.push((await call()).s);
const first = codes.indexOf(429) + 1;
console.log(`${N} requêtes sans en-tête particulier : ${[...new Set(codes)].map((c) => `${c}×${codes.filter((x) => x === c).length}`).join(', ')}`);
let verdict = 0;
if (!first) { console.log(`FAILLE  jamais bloqué après ${N} requêtes (limite attendue : ${LIMIT}) → l'IP vue par l'application n'est pas celle du visiteur.`);
  console.log('        Causes probables : `trust proxy` mal réglé (IP d\'un relais interne, changeante ou partagée). Lire l\'IP réelle dans l\'en-tête posé par le CDN (ex. CF-Connecting-IP), jamais dans un en-tête que le client peut forger.'); verdict = 1; }
else if (Math.abs(first - (LIMIT + 1)) > 3) { console.log(`ATTENTION premier 429 à la requête n°${first} (attendu ≈ ${LIMIT + 1}) : compteur partagé avec d'autres visiteurs ou fenêtre déjà entamée. Relancer après 1 minute.`); verdict = 1; }
else console.log(`OK     limite effective : premier 429 à la requête n°${first} (attendu ≈ ${LIMIT + 1}).`);

if (first) {
  const sp = [['X-Forwarded-For: 203.0.113.77', { 'X-Forwarded-For': '203.0.113.77' }], ['True-Client-IP: 203.0.113.79', { 'True-Client-IP': '203.0.113.79' }], ['X-Real-IP: 203.0.113.80', { 'X-Real-IP': '203.0.113.80' }]];
  for (const [label, h] of sp) { const r = await call(h); const ok = r.s === 429; if (!ok) verdict = 1; console.log(`${ok ? 'OK    ' : 'FAILLE'} en-tête falsifié (${label}) → HTTP ${r.s} ${ok ? '(toujours bloqué)' : "(l'attaquant change de compteur à volonté !)"}`); }
  const cf = await call({ 'CF-Connecting-IP': '203.0.113.78' });
  console.log(`INFO   CF-Connecting-IP falsifié → HTTP ${cf.s} ${cf.s === 403 ? '(refusé par Cloudflare : l\'en-tête est fiable derrière Cloudflare)' : cf.s === 429 ? '(toujours bloqué)' : '(passe : ne PAS utiliser cet en-tête comme IP cliente sans Cloudflare devant)'}`);
}
console.log(verdict ? '\nRÉSULTAT : limitation par IP à corriger.' : '\nRÉSULTAT : limitation par IP fiable.');
process.exit(verdict);
