// PostgreSQL local de développement (PGlite : vrai PostgreSQL compilé en WebAssembly).
// Aucune installation requise. Ne sert qu'au développement : en production, utilisez un vrai serveur PostgreSQL.
//   Terminal 1 : npm run db:dev
//   Terminal 2 : DATABASE_URL=postgres://postgres:postgres@localhost:15433/postgres DB_POOL_MAX=1 npm run dev
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const dir = path.resolve(process.env.DEV_DB_DIR || 'data/pg');
const port = Number(process.env.DEV_DB_PORT) || 15433;

const db = await PGlite.create(dir);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
await server.start();

console.log(`PostgreSQL de développement prêt sur le port ${port} (données : ${dir})`);
console.log(`DATABASE_URL=postgres://postgres:postgres@localhost:${port}/postgres`);
console.log('Ctrl+C pour arrêter.');

const stop = async () => { await server.stop(); await db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
