// Recherche de secrets dans les fichiers suivis ET dans tout l'historique Git. Les valeurs ne sont JAMAIS affichées (2 premiers caractères + longueur).
// Usage : node secret-scan.mjs [--github owner/repo] [--env .env,.env.production]
//   --env : fichiers .env dont les VALEURS sont recherchées dans le dépôt (par défaut : tous les .env* sauf *.example)
//   --github : vérifie si le dépôt est public (API GitHub anonyme) ; le code, l'historique et l'email d'auteur seraient alors visibles de tous.
// Code de sortie 1 si un problème est trouvé.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : ''; };
const sh = (c) => execSync(c, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
let problems = 0;
const bad = (m) => { problems++; console.log('FAILLE ', m); };
const ok = (m) => console.log('OK     ', m);
const mask = (v) => `${v.slice(0, 2)}…(${v.length} car.)`;

try { sh('git rev-parse --is-inside-work-tree'); } catch { console.error('Pas un dépôt Git.'); process.exit(1); }
const files = sh('git ls-files').split('\n').filter(Boolean);
const history = sh('git log --all -p --no-color');

/* 1) Fichiers sensibles jamais commités (historique complet) */
const everFiles = [...new Set(sh('git log --all --name-only --pretty=format:').split('\n').filter(Boolean))];
const sensitiveName = everFiles.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !/\.example$|\.sample$/.test(f) || /\.(pem|key|p12|pfx|jks)$/i.test(f) || /(^|\/)(id_rsa|\.npmrc|credentials)$/i.test(f));
sensitiveName.length ? bad(`fichiers sensibles présents dans l'historique : ${sensitiveName.join(', ')}`) : ok('aucun .env / clé privée / certificat dans l\'historique Git');
const risky = everFiles.filter((f) => /\.(sql|sqlite3?|db|dump|bak)$/i.test(f) || /(^|\/)(config|wp-config|settings)\.php$/i.test(f));
if (risky.length) console.log('ATTENTION', `fichiers à vérifier (données ou configuration) dans l'historique : ${risky.join(', ')}`);

/* 2) Valeurs réelles des .env retrouvées dans le dépôt */
const envFiles = (arg('--env') ? arg('--env').split(',') : fs.readdirSync('.').filter((f) => /^\.env(\..+)?$/.test(f) && !/\.(example|sample)$/.test(f))).filter((f) => fs.existsSync(f));
const secrets = [];
for (const f of envFiles) for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line); if (!m) continue;
  const key = m[1], val = m[2].trim().replace(/^["']|["']$/g, '');
  if (!val) continue;
  if (/PASS|SECRET|TOKEN|KEY|PRIVATE/i.test(key) && val.length >= 8) secrets.push([key, val]);
  if (/URL|URI|DSN/i.test(key) && /^[a-z][a-z0-9+.-]*:\/\//i.test(val)) {
    try { const u = new URL(val); if (u.password) { secrets.push([key + ' (chaîne complète)', val]); secrets.push([key + ' (mot de passe dans une URL)', `:${decodeURIComponent(u.password)}@`]); } } catch { /* ignoré */ }
  }
}
let leaked = 0;
for (const [key, val] of secrets) {
  const inFiles = files.filter((f) => { try { return fs.readFileSync(f, 'utf8').includes(val); } catch { return false; } });
  const inHist = history.includes(val);
  if (inFiles.length || inHist) { leaked++; bad(`${key} (${mask(val)}) retrouvé ${inFiles.length ? 'dans ' + inFiles.join(', ') : ''}${inHist ? ' / dans l\'historique Git' : ''}`); }
}
if (!leaked) ok(`${secrets.length} secret(s) lus dans ${envFiles.join(', ') || '(aucun .env)'} : aucun ne figure dans les fichiers ni dans l'historique`);

/* 3) Motifs de secrets génériques (fichiers + historique) */
const patterns = [
  ['clé privée', /-----BEGIN [A-Z ]*PRIVATE KEY-----/], ['clé AWS', /AKIA[0-9A-Z]{16}/], ['jeton GitHub', /gh[pousr]_[A-Za-z0-9]{30,}/], ['clé Stripe live', /sk_live_[A-Za-z0-9]{10,}/],
  ['jeton Slack', /xox[baprs]-[A-Za-z0-9-]{10,}/], ['clé Google', /AIza[0-9A-Za-z_-]{30,}/], ['jeton JWT', /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ['URL avec mot de passe', /[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]{4,}@[^\s/]+/i], ['mot de passe affecté en dur', /(password|passwd|secret|api[_-]?key|token)['"]?\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
];
const EXAMPLE = /(example|exemple|placeholder|votre|your|xxxx|changeme|mauvais|devine|wrong|dummy|fake|faux|<[^>]+>|localhost|127\.0\.0\.1|postgres:postgres)/i;
const hits = new Map();
for (const line of history.split('\n')) {
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  for (const [label, re] of patterns) { const m = re.exec(line); if (m && !EXAMPLE.test(m[0])) hits.set(`${label}: ${mask(m[0].replace(/^[^=:]*[=:]\s*['"]?/, '').slice(0, 40))}`, (hits.get(label) || 0) + 1); }
}
hits.size ? [...hits.keys()].slice(0, 15).forEach((h) => bad(`motif suspect dans l'historique — ${h}`)) : ok('aucun motif de secret connu (clés privées, jetons, URL avec mot de passe, mots de passe en dur) hors exemples');

/* 4) Emails d'auteur exposés si le dépôt est public */
const authors = [...new Set(sh('git log --all --format=%ae').split('\n').filter(Boolean))];
const noreply = authors.filter((a) => /@users\.noreply\.github\.com$/.test(a)), real = authors.filter((a) => !/@users\.noreply\.github\.com$/.test(a));
console.log(`INFO    emails d'auteur dans l'historique : ${real.length} réel(s), ${noreply.length} noreply`);
const repo = arg('--github');
if (repo) {
  const status = await new Promise((res) => https.get({ host: 'api.github.com', path: `/repos/${repo}`, headers: { 'User-Agent': 'secret-scan' }, timeout: 20000 }, (r) => { let s = ''; r.on('data', (d) => (s += d)); r.on('end', () => { try { res({ code: r.statusCode, vis: JSON.parse(s).visibility }); } catch { res({ code: r.statusCode }); } }); }).on('error', () => res({ code: 0 })));
  if (status.vis === 'public') { bad(`le dépôt ${repo} est PUBLIC : code, historique et emails d'auteur sont visibles de tous${real.length ? ` (${real.length} email(s) réel(s) exposé(s))` : ''}`); }
  else if (status.code === 404) ok(`le dépôt ${repo} n'est pas visible publiquement (privé ou inexistant)`);
  else console.log('INFO    visibilité GitHub indéterminée (HTTP', status.code + ')');
}

console.log(problems ? `\nRÉSULTAT : ${problems} problème(s) à traiter.` : '\nRÉSULTAT : rien à signaler.');
process.exit(problems ? 1 : 0);
