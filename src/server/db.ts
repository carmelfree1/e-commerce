import pg from 'pg';
import { config } from './config.js';

// Les COUNT/SUM restent des nombres JS (castés en ::int dans les requêtes) ; les dates sortent en ISO.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: Number(process.env.DB_POOL_MAX) || 10,
  keepAlive: true,
  idleTimeoutMillis: 30_000,
});
pool.on('error', (e) => console.error('Erreur PostgreSQL (connexion inactive) :', e.message));

export type Db = pg.Pool | pg.PoolClient;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Crée la base si elle n'existe pas (nécessite le droit CREATEDB). */
export async function ensureDatabase(): Promise<void> {
  const probe = new pg.Client({ connectionString: config.databaseUrl });
  try {
    await probe.connect();
    await probe.end();
    return;
  } catch (e) {
    await probe.end().catch(() => {});
    if ((e as { code?: string }).code !== '3D000') throw e;
  }
  const url = new URL(config.databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z0-9_]{1,63}$/.test(name)) throw new Error(`Nom de base invalide : ${name}`);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    console.log(`Base « ${name} » créée.`);
  } finally {
    await admin.end();
  }
}

const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE settings (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE admins (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  salt text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price integer NOT NULL CHECK (price >= 0),
  category text NOT NULL DEFAULT 'Divers',
  image text NOT NULL DEFAULT '',
  stock integer NOT NULL CHECK (stock >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_active_idx ON products (active, stock);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  customer_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  note text NOT NULL DEFAULT '',
  total integer NOT NULL CHECK (total >= 0),
  status text NOT NULL DEFAULT 'en_attente'
    CHECK (status IN ('en_attente','confirmee','en_livraison','livree','annulee')),
  push_endpoint text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_idx ON orders (status);
CREATE INDEX orders_created_idx ON orders (created_at DESC);

CREATE TABLE order_items (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id integer REFERENCES products(id) ON DELETE SET NULL,
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  qty integer NOT NULL CHECK (qty > 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE subscriptions (
  endpoint text PRIMARY KEY,
  data jsonb NOT NULL,
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('admin','client')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_role_idx ON subscriptions (role);
`,
  },
  {
    id: 2,
    sql: `
ALTER TABLE products
  ADD COLUMN kind text NOT NULL DEFAULT 'produit' CHECK (kind IN ('produit','medicament')),
  ADD COLUMN usage text NOT NULL DEFAULT '';
-- Un médicament traditionnel doit toujours avoir un mode d'emploi renseigné.
ALTER TABLE products
  ADD CONSTRAINT products_usage_required CHECK (kind <> 'medicament' OR length(btrim(usage)) >= 10);
`,
  },
  {
    id: 3,
    // Tableau de bord : filtres par statut et par période sans balayer toute la table.
    sql: `
CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS products_stock_idx ON products (stock);
`,
  },
  {
    id: 4,
    // La photo est copiée dans la ligne de commande : elle reste visible même si le produit est modifié ou supprimé.
    sql: `
ALTER TABLE order_items ADD COLUMN image text NOT NULL DEFAULT '';
UPDATE order_items i SET image = p.image FROM products p WHERE p.id = i.product_id;
`,
  },
  {
    id: 5,
    // Sessions admin révocables : seule l'empreinte SHA-256 de l'identifiant est stockée.
    sql: `
CREATE TABLE admin_sessions (
  id text PRIMARY KEY,
  admin_id integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions (admin_id);
CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);
`,
  },
  {
    id: 6,
    // Codes à 6 chiffres du « mot de passe oublié » : stockés sous forme d'empreinte HMAC, 10 min, 5 essais, usage unique.
    sql: `
CREATE TABLE password_resets (
  id serial PRIMARY KEY,
  admin_id integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_admin_idx ON password_resets (admin_id, id DESC);
`,
  },
];

export async function migrate(): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727001)'); // évite deux migrations simultanées
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query<{ id: number }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migrations(id) VALUES ($1)', [m.id]);
        await c.query('COMMIT');
        console.log(`Migration ${m.id} appliquée.`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727001)').catch(() => {});
    c.release();
  }
}

export async function getSetting(key: string, db: Db = pool): Promise<string | undefined> {
  const r = await db.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [key]);
  return r.rows[0]?.value;
}
export async function setSetting(key: string, value: string, db: Db = pool): Promise<void> {
  await db.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
}
