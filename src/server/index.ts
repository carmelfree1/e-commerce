import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { ensureDatabase, getSetting, migrate, pool, setSetting } from './db.js';
import { MIN_PASSWORD, hashPassword, newSalt, setSecret } from './security.js';
import { initPush } from './push.js';
import { mailConfigured } from './mailer.js';
import { createApp } from './app.js';

async function seedAdmin() {
  if ((await pool.query('SELECT 1 FROM admins LIMIT 1')).rowCount) return;
  if (config.adminPassword && config.adminPassword.length < MIN_PASSWORD) {
    throw new Error(`ADMIN_PASSWORD trop court (${MIN_PASSWORD} caractères minimum).`);
  }
  const pw = config.adminPassword || crypto.randomBytes(12).toString('base64url');
  const salt = newSalt();
  await pool.query('INSERT INTO admins(email, salt, hash) VALUES ($1,$2,$3)', [config.adminEmail, salt, await hashPassword(pw, salt)]);
  console.log('\n=== Compte administrateur créé ===');
  console.log(`  Email        : ${config.adminEmail}`);
  console.log(`  Mot de passe : ${pw}`);
  console.log('  (changez-le dans Admin > Mon compte)\n');
}

async function seedDemo() {
  if (!config.seedDemo || (await pool.query('SELECT 1 FROM products LIMIT 1')).rowCount) return;
  const demo: [string, string, number, string, number][] = [
    ['Miel pur de brousse 500 g', 'Miel brut récolté localement, sans additif.', 3500, 'Épicerie', 40],
    ['Huile de coco vierge 250 ml', 'Pressée à froid, idéale pour la cuisine et la peau.', 4000, 'Huiles', 25],
    ['Mangues bio (1 kg)', "Mangues mûries à l'arbre, cultivées sans pesticides.", 1500, 'Fruits', 60],
    ['Beurre de karité brut 200 g', 'Beurre de karité non raffiné.', 2500, 'Cosmétiques', 30],
    ['Tisane de citronnelle 20 sachets', 'Citronnelle séchée, sans additif.', 1800, 'Boissons', 3],
    ['Gombo frais bio (500 g)', 'Récolté le jour même.', 1000, 'Légumes', 0],
  ];
  for (const d of demo) await pool.query('INSERT INTO products(name, description, price, category, stock) VALUES ($1,$2,$3,$4,$5)', d);
}

async function main() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await ensureDatabase();
  await migrate();

  let secret = config.sessionSecret || (await getSetting('session_secret'));
  if (!secret) { secret = crypto.randomBytes(32).toString('hex'); await setSetting('session_secret', secret); }
  setSecret(secret);

  await initPush();
  if (config.isProd && !mailConfigured) console.warn('⚠ SMTP_HOST non défini : le « mot de passe oublié » ne pourra pas envoyer de code par email.');
  if (mailConfigured && (!config.smtpUser || !config.smtpPass)) console.warn("⚠ SMTP_USER / SMTP_PASS manquants : l'envoi d'emails échouera tant qu'ils ne sont pas renseignés.");
  await seedAdmin();
  await seedDemo();

  createApp().listen(config.port, () => {
    console.log(`CCM-NONSAKA → http://localhost:${config.port}  (admin : http://localhost:${config.port}/admin/)`);
  });
}

main().catch((e) => {
  const err = e as { code?: string; message?: string };
  console.error('\nDémarrage impossible :', err.message || e);
  if (err.code === 'ECONNREFUSED' || err.code === '28P01' || err.code === '28000') {
    console.error('Vérifiez DATABASE_URL (utilisateur, mot de passe, hôte) dans le fichier .env — voir .env.example.');
  }
  process.exit(1);
});
