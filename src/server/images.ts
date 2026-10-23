import { pool } from './db.js';

/**
 * Les photos produits sont stockées dans PostgreSQL (table `images`) et non sur le disque du serveur :
 * les hébergeurs comme Render ou Railway effacent le disque à chaque redéploiement.
 * Les photos sont de toute façon réduites côté navigateur (≈ 1200 px, WebP), donc légères.
 */
export const IMAGE_FILE_RE = /^[a-f0-9]{24}\.(jpg|png|webp)$/;
export const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Espace maximal occupé par les photos (la base gratuite de Neon offre 0,5 Go au total). */
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024;

export interface StoredImage { mime: string; data: Buffer }

/* Petit cache mémoire (≤ 24 Mo) : évite un aller-retour vers la base pour les photos les plus vues. */
const CACHE_MAX = 24 * 1024 * 1024;
const cache = new Map<string, StoredImage>();
let cacheBytes = 0;

function remember(file: string, img: StoredImage): void {
  if (img.data.length > CACHE_MAX / 4) return;
  cache.set(file, img);
  cacheBytes += img.data.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_MAX) break;
    cache.delete(k);
    cacheBytes -= v.data.length;
  }
}

export async function getImage(file: string): Promise<StoredImage | null> {
  const hit = cache.get(file);
  if (hit) return hit;
  const r = await pool.query<StoredImage>('SELECT mime, data FROM images WHERE file = $1', [file]);
  const img = r.rows[0];
  if (!img) return null;
  remember(file, img);
  return img;
}

export async function saveImage(file: string, mime: string, data: Buffer): Promise<void> {
  await pool.query('INSERT INTO images(file, mime, data, size) VALUES ($1,$2,$3,$4)', [file, mime, data, data.length]);
}

export async function totalImageBytes(): Promise<number> {
  const r = await pool.query<{ n: string }>('SELECT COALESCE(SUM(size), 0)::text AS n FROM images');
  return Number(r.rows[0].n);
}

/** Supprime les photos envoyées depuis plus de 24 h qui ne sont plus utilisées par aucun produit ni aucune commande. */
export async function cleanupOrphanImages(): Promise<number> {
  const r = await pool.query(`
    DELETE FROM images i
    WHERE i.created_at < now() - interval '1 day'
      AND NOT EXISTS (SELECT 1 FROM products p WHERE p.image = '/uploads/' || i.file)
      AND NOT EXISTS (SELECT 1 FROM order_items o WHERE o.image = '/uploads/' || i.file)`);
  for (const k of [...cache.keys()]) {
    const still = await pool.query('SELECT 1 FROM images WHERE file = $1', [k]);
    if (!still.rowCount) { cacheBytes -= cache.get(k)!.data.length; cache.delete(k); }
  }
  return r.rowCount ?? 0;
}
