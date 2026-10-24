import crypto from 'node:crypto';
import { pool } from './db.js';
import type { PublicProduct } from '../shared/types.js';

interface Cached { json: string; etag: string; at: number }

/** Durée de vie maximale : filet de sécurité si plusieurs instances du serveur tournent. */
const TTL_MS = 5000;
let cached: Cached | null = null;
let lastGood: Cached | null = null; // dernière version connue, servie si la base est momentanément indisponible
let loading: Promise<Cached> | null = null;

/** À appeler après toute écriture qui touche aux produits ou aux stocks. */
export const invalidateProducts = (): void => { cached = null; };

async function load(): Promise<Cached> {
  const { rows } = await pool.query<PublicProduct>(
    `SELECT id, name, description, price, category, image, stock, kind, usage
     FROM products WHERE active ORDER BY (stock = 0), id DESC`);
  const json = JSON.stringify(rows);
  const etag = `W/"${crypto.createHash('sha1').update(json).digest('base64url').slice(0, 20)}"`;
  return { json, etag, at: Date.now() };
}

/** Catalogue public sérialisé une seule fois, partagé par toutes les requêtes simultanées. */
export function getPublicProducts(): Promise<Cached> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached);
  loading ??= load()
    .then((c) => { cached = c; lastGood = c; return c; })
    .catch((e) => {
      // Base injoignable (panne, réveil de Neon…) : on sert la dernière liste connue plutôt que de casser toute la boutique.
      if (lastGood) {
        console.error('Catalogue servi depuis le cache (base indisponible) :', (e as Error).message);
        cached = { ...lastGood, at: Date.now() }; // on réessaiera la base dans 5 s, pas à chaque visiteur
        return cached;
      }
      throw e;
    })
    .finally(() => { loading = null; });
  return loading;
}
