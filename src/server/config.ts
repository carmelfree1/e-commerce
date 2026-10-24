import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// src/server/ en dev, dist/ après build : la racine du projet est toujours le dossier parent du dossier courant ou de son parent.
const root = path.basename(here) === 'server' ? path.resolve(here, '..', '..') : path.resolve(here, '..');

export const config = {
  root,
  port: Number(process.env.PORT) || 3000,
  isProd: process.env.NODE_ENV === 'production',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ccm_nonsaka',
  publicDir: path.join(root, 'public'),
  uploadDir: path.join(root, 'uploads'),
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@ccm-nonsaka.com').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || '',
  seedDemo: process.env.SEED_DEMO !== '0',
  sessionSecret: process.env.SESSION_SECRET || '',
  // Envoi d'emails (code « mot de passe oublié »)
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === 'true' || Number(process.env.SMTP_PORT) === 465,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  mailFrom: process.env.MAIL_FROM || (process.env.SMTP_USER ? `CCM-NONSAKA <${process.env.SMTP_USER}>` : 'CCM-NONSAKA <no-reply@localhost>'),
  /**
   * Nombre de proxys de confiance devant l'app (X-Forwarded-For n'est lu que dans ce cas).
   * Par défaut : 1 en production (HTTPS impose un proxy), 0 en développement. Mal réglé, ce paramètre
   * permettrait à un attaquant de falsifier son IP et de contourner la limitation de débit.
   */
  /**
   * En-tête portant l'IP réelle du visiteur, posée par Cloudflare (Render est placé derrière Cloudflare) : « cf-connecting-ip ».
   * Cloudflare refuse les requêtes où le client forge cet en-tête, donc il est fiable tant que le site n'est joignable que via Cloudflare.
   * Sur Render (variable RENDER=true) il est activé automatiquement ; vide ailleurs. N'activez JAMAIS un en-tête qui n'est pas posé
   * par un proxy de confiance : n'importe qui pourrait se faire passer pour une autre IP.
   */
  clientIpHeader: (process.env.CLIENT_IP_HEADER ?? (process.env.RENDER === 'true' ? 'cf-connecting-ip' : '')).trim().toLowerCase(),
  trustProxy: process.env.TRUST_PROXY !== undefined ? (Number(process.env.TRUST_PROXY) || false) : (process.env.NODE_ENV === 'production' ? 1 : false),
};
