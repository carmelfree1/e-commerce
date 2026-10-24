// Faux SERVICE PUSH (Web Push) local : reçoit les notifications envoyées par le serveur, les DÉCHIFFRE avec les clés de l'appareil
// (RFC 8291, aes128gcm) et VÉRIFIE la signature VAPID (JWT ES256) — exactement ce que ferait un navigateur.
// Dépendances : `http_ece` (installée avec le paquet `web-push`) et un certificat TLS de test (auto-signé).
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout k.pem -out c.pem -subj "/CN=localhost" -days 1
// Utilisation :
//   import { startMockPush } from './mock-push.mjs';
//   const push = await startMockPush({ tlsDir: './tls', port: 9443 });
//   const dev = push.newDevice('/admin-device');     // { endpoint, keys: { p256dh, auth } } à enregistrer en base (rôle voulu)
//   // lancer l'appli avec NODE_TLS_REJECT_UNAUTHORIZED=0 (test uniquement !) ; l'allowlist anti-SSRF refusera localhost via l'API :
//   // insérer la ligne d'abonnement directement en base de test (INSERT INTO subscriptions ...).
//   const msg = await push.waitFor((m) => /Nouvelle commande/.test(m.payload?.title));
//   msg.payload, msg.jwtOk, msg.headers['content-encoding']
//   dev = '/gone' → répond 410 (l'appli doit supprimer l'abonnement)
// Mettre `vapidPublic` (clé publique du serveur) avec push.setVapidPublic(key) pour contrôler `k=` dans l'en-tête.
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';

export async function startMockPush({ tlsDir, port = 9443, projectRoot = process.cwd() } = {}) {
  const require = createRequire(`${projectRoot}/package.json`);
  const ece = require('http_ece');
  const received = [], devices = {};
  let vapidPublic = '';

  const server = https.createServer({ key: fs.readFileSync(`${tlsDir}/k.pem`), cert: fs.readFileSync(`${tlsDir}/c.pem`) }, (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/gone') { res.statusCode = 410; return res.end(); }
      const dev = devices[req.url];
      let payload = null, jwtOk = false;
      try {
        payload = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: 'aes128gcm', privateKey: dev.ecdh, authSecret: dev.auth.toString('base64url') }).toString());
      } catch (e) { payload = { error: String(e.message || e) }; }
      const m = /^vapid t=([^,]+), k=(.+)$/.exec(req.headers.authorization || '');
      if (m) {
        const [h, p, s] = m[1].split('.'), pub = Buffer.from(m[2], 'base64url');
        const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
        const claims = JSON.parse(Buffer.from(p, 'base64url'));
        jwtOk = crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
          && (!vapidPublic || m[2] === vapidPublic) && claims.aud === `https://localhost:${port}` && claims.exp > Date.now() / 1000 && /^mailto:/.test(claims.sub);
      }
      received.push({ path: req.url, headers: req.headers, payload, jwtOk });
      res.statusCode = 201; res.end();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, resolve); });

  return {
    received,
    setVapidPublic(k) { vapidPublic = k; },
    /** Crée un « appareil » : clés ECDH P-256 + secret d'authentification. */
    newDevice(path) {
      const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
      const auth = crypto.randomBytes(16);
      devices[path] = { ecdh, auth };
      return { endpoint: `https://localhost:${port}${path}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
    },
    async waitFor(pred, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { const v = received.find(pred); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } return null; },
    close() { server.close(); },
  };
}
