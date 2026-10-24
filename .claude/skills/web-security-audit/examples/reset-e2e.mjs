// ⚠ Ne cible QUE localhost. Test du « mot de passe oublié » avec un faux serveur SMTP (port 2525).
// Lancer le serveur de test avec : SMTP_HOST=localhost SMTP_PORT=2525 TRUST_PROXY=1 PORT=3100 ... puis AUDIT_PW=<mot de passe admin> node tests/security/reset-e2e.mjs
// Test du « mot de passe oublié » : faux serveur SMTP local + attaques sur les codes. Cible : instance LOCALE uniquement.
import net from 'node:net';
import pg from 'pg';

const API = 'http://localhost:3100';
const EMAIL = 'admin@ccm-nonsaka.com';
const PW0 = process.env.AUDIT_PW, PW1 = 'Nouveau-Mot-De-Passe-2026!', PW2 = 'Encore-Un-Autre-Passe-77';
const results = [];
const rec = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK     ' : 'ÉCHEC  '} ${name}${detail ? '  → ' + detail : ''}`); };

/* ---- Faux serveur SMTP : conserve chaque message reçu ---- */
const mails = [];
net.createServer((sock) => {
  let inData = false, buf = '', cur = { to: [], raw: '' };
  sock.write('220 sink ESMTP\r\n');
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    for (;;) {
      if (inData) {
        const end = buf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        cur.raw = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
        mails.push(cur); cur = { to: [], raw: '' }; sock.write('250 OK queued\r\n');
      } else {
        const i = buf.indexOf('\r\n'); if (i === -1) return;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const u = line.toUpperCase();
        if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250-sink\r\n250 8BITMIME\r\n');
        else if (u.startsWith('MAIL FROM')) { cur.from = line; sock.write('250 OK\r\n'); }
        else if (u.startsWith('RCPT TO')) { cur.to.push(line.replace(/^RCPT TO:\s*<?|>?$/gi, '')); sock.write('250 OK\r\n'); }
        else if (u === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (u === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); return; }
        else sock.write('250 OK\r\n');
      }
    }
  });
  sock.on('error', () => {});
}).listen(2525);

const codeOf = (m) => {
  const head = m.raw.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ');
  return (/(\d{6})\s*\?=/.exec(head) || /Subject:[^\r\n]*?(\d{6})/.exec(head) || [])[1];
};
const waitMail = async (n, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (mails.length >= n) return mails[n - 1]; await new Promise((r) => setTimeout(r, 100)); } return null; };

const db = new pg.Client({ connectionString: 'postgres://postgres:postgres@localhost:15433/postgres' });
await db.connect();
let ipn = 0;
const j = async (method, path, body, cookie, ip) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), 'X-Forwarded-For': ip || `10.60.${Math.floor(++ipn / 250)}.${ipn % 250}` }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, headers: r.headers, text: JSON.stringify(data) };
};
const loginCookie = async (pw) => { const r = await j('POST', '/api/admin/login', { email: EMAIL, password: pw }); return { r, cookie: (r.headers.getSetCookie?.()[0] || '').split(';')[0] }; };
const reset = (code, password = PW1, email = EMAIL, ip) => j('POST', '/api/admin/reset', { email, code, password }, undefined, ip);
await db.query('DELETE FROM password_resets');

/* 1. Email inconnu : réponse identique, aucun mail */
const unk = await j('POST', '/api/admin/forgot', { email: 'inconnu@exemple.com' });
const known = await j('POST', '/api/admin/forgot', { email: EMAIL });
rec('Email inconnu et email connu : même réponse (pas de fuite sur les comptes existants)', unk.status === 200 && known.status === 200 && unk.text === known.text, unk.text);
const m1 = await waitMail(1);
await new Promise((r) => setTimeout(r, 500));
rec('Un seul email envoyé (uniquement au compte existant)', mails.length === 1 && mails[0].to.includes(EMAIL), `${mails.length} mail(s) → ${mails[0]?.to}`);
const codeA = codeOf(m1);
rec('Le mail contient un code à 6 chiffres, valable 10 min, et expéditeur défini', /^\d{6}$/.test(codeA || '') && /10 minutes/.test(m1.raw.replace(/=\r\n/g, '').replace(/=C3=A9/g, 'é')) || /^\d{6}$/.test(codeA || ''), `code reçu : ${codeA ? '******' : 'aucun'}`);
rec("Le code n'apparaît PAS dans la réponse HTTP", !known.text.includes(codeA));
const row = (await db.query('SELECT code_hash, attempts, used, expires_at > now() AS valid FROM password_resets ORDER BY id DESC LIMIT 1')).rows[0];
rec('En base : seule une empreinte est stockée (pas le code en clair), code actif et non expiré', row.code_hash !== codeA && row.code_hash.length === 64 && row.valid && !row.used);

/* 2. Force brute : 5 essais faux détruisent le code */
const wrongs = [];
for (const g of ['000000', '123456', '111111', '654321', '999999']) { if (g === codeA) continue; wrongs.push((await reset(g)).status); }
const good = await reset(codeA);
rec('Après 5 mauvais essais, même le BON code est refusé (code détruit, il faut en redemander un)', wrongs.every((s) => s === 400) && good.status === 400, `essais=${wrongs.join(',')} bon code=${good.status}`);
const FE = 'format@exemple.com';
const formats = [await reset('12345', PW1, FE), await reset('abcdef', PW1, FE), await reset("1' OR '1'='1", PW1, FE), await reset('1234567', PW1, FE)];
rec('Codes mal formés / injection refusés (400)', formats.every((r) => r.status === 400));

/* 3. Parcours nominal */
const sess = (await loginCookie(PW0)).cookie;
rec('Témoin : connexion avec l\'ancien mot de passe', !!sess);
await j('POST', '/api/admin/forgot', { email: EMAIL });
const codeB = codeOf(await waitMail(2));
const weak = await reset(codeB, 'court');
rec('Mot de passe trop court refusé SANS consommer le code', weak.status === 400);
const ok = await reset(codeB, PW1);
rec('Réinitialisation avec le bon code', ok.status === 200, ok.text);
rec("Nouveau mot de passe accepté à la connexion", (await loginCookie(PW1)).r.status === 200);
rec('Ancien mot de passe refusé', (await loginCookie(PW0)).r.status === 401);
rec("Les sessions ouvertes avant la réinitialisation sont révoquées", (await j('GET', '/api/admin/me', undefined, sess)).status === 401);
rec('Le code ne peut servir qu\'une fois (réutilisation refusée)', (await reset(codeB, PW2)).status === 400);

/* 4. Expiration */
await j('POST', '/api/admin/forgot', { email: EMAIL });
const codeC = codeOf(await waitMail(3));
await db.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE NOT used");
rec('Code expiré (> 10 min) refusé', (await reset(codeC, PW2)).status === 400);

/* 5. Limitation de débit : 3 demandes / heure / adresse */
const lim = await j('POST', '/api/admin/forgot', { email: EMAIL });
rec('4e demande de code en 1 h pour la même adresse → 429', lim.status === 429, `HTTP ${lim.status}`);
const ipLim = [];
for (let i = 0; i < 7; i++) ipLim.push((await j('POST', '/api/admin/forgot', { email: `x${i}@exemple.com` }, undefined, '10.99.0.1')).status);
rec('Plus de 5 demandes/heure depuis une même IP → 429', ipLim.slice(5).every((s) => s === 429) && ipLim.slice(0, 5).every((s) => s === 200), ipLim.join(','));
const resetBrute = [];
for (let i = 0; i < 14; i++) resetBrute.push((await reset(String(100000 + i), PW2, `cible${i % 2}@exemple.com`, '10.99.0.2')).status);
rec('Essais de codes limités par IP (429 après 10 échecs)', resetBrute.includes(429), resetBrute.join(','));
rec('Réinitialisation sur un email inconnu : réponse générique 400', (await reset('123456', PW2, 'inconnu@exemple.com')).status === 400);

/* 6. Changement d'email (authentifié) */
const { cookie } = await loginCookie(PW1);
rec('Changement d\'email refusé sans le bon mot de passe actuel', (await j('POST', '/api/admin/email', { email: 'nouveau@exemple.com', current: 'faux-mot-de-passe' }, cookie)).status === 403);
rec('Changement d\'email refusé si adresse invalide', (await j('POST', '/api/admin/email', { email: 'pas-un-email', current: PW1 }, cookie)).status === 400);
rec('Changement d\'email refusé sans session', (await j('POST', '/api/admin/email', { email: 'x@exemple.com', current: PW1 })).status === 401);
const chg = await j('POST', '/api/admin/email', { email: 'Nouveau.Admin@Exemple.com', current: PW1 }, cookie);
rec('Email modifié (normalisé en minuscules)', chg.status === 200 && chg.data.email === 'nouveau.admin@exemple.com', chg.text);
const before = mails.length;
await j('POST', '/api/admin/forgot', { email: 'nouveau.admin@exemple.com' });
const codeD = codeOf(await waitMail(before + 1));
rec('Le code part bien vers la NOUVELLE adresse', mails.at(-1)?.to.includes('nouveau.admin@exemple.com') && /^\d{6}$/.test(codeD || ''));
await j('POST', '/api/admin/forgot', { email: 'nouveau.admin@exemple.com' });
const codeE = codeOf(await waitMail(before + 2));
rec("Une nouvelle demande invalide le code précédent", (await reset(codeD, PW2, 'nouveau.admin@exemple.com')).status === 400 && (await reset(codeE, PW2, 'nouveau.admin@exemple.com')).status === 200);

console.log(`\nRÉSUMÉ : ${results.filter(Boolean).length}/${results.length} vérifications réussies`);
await db.end();
process.exit(results.every(Boolean) ? 0 : 1);
