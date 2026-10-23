import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { getPublicProducts } from './cache.js';

const indexPath = path.join(config.publicDir, 'index.html');
// Fichiers servis avec ?v=<date de modification> : cache navigateur « immutable » d'un an, invalidé à chaque build.
const VERSIONED = ['/assets/shop.js', '/css/style.css'];

let template: string | null = null;

const version = (p: string): number => {
  try { return Math.floor(fs.statSync(path.join(config.publicDir, p)).mtimeMs); } catch { return 0; }
};

/**
 * Page d'accueil avec le catalogue déjà embarqué : le navigateur affiche les produits
 * dès la réception du HTML, sans attendre une seconde requête vers l'API.
 */
export async function renderShop(): Promise<string> {
  if (!config.isProd || template === null) template = fs.readFileSync(indexPath, 'utf8');
  let html = template;
  for (const a of VERSIONED) html = html.replaceAll(`"${a}"`, `"${a}?v=${version(a)}"`);
  const { json } = await getPublicProducts();
  const safe = json.replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
  return html.replace('<!--BOOT_DATA-->', `<script id="boot" type="application/json">${safe}</script>`);
}
