// Change l'adresse email de l'administrateur directement en base (utile si vous ne pouvez plus vous connecter).
// Usage :  npm run admin:email -- votre.adresse@gmail.com
// Lit DATABASE_URL dans .env (ou dans l'environnement). Ne touche ni au mot de passe ni aux sessions.
import pg from 'pg';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) || email.length > 254) {
  console.error('Usage : npm run admin:email -- adresse@exemple.com');
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL introuvable (fichier .env manquant ?).');
  process.exit(1);
}

const db = new pg.Client({ connectionString: url });
try {
  await db.connect();
  const admins = (await db.query<{ id: number; email: string }>('SELECT id, email FROM admins ORDER BY id')).rows;
  if (admins.length !== 1) {
    console.error(`${admins.length} comptes admin trouvés : ce script ne gère que le cas d'un seul administrateur.`);
    process.exit(1);
  }
  const [a] = admins;
  if (a.email === email) {
    console.log(`L'adresse de l'administrateur est déjà ${email}.`);
  } else {
    await db.query('UPDATE admins SET email = $1 WHERE id = $2', [email, a.id]);
    await db.query('UPDATE password_resets SET used = true WHERE admin_id = $1', [a.id]); // anciens codes invalidés
    console.log(`Adresse de l'administrateur : ${a.email}  →  ${email}`);
  }
} catch (e) {
  const err = e as { code?: string; message?: string };
  console.error('Échec :', err.code === '23505' ? 'cette adresse est déjà utilisée.' : err.message);
  process.exit(1);
} finally {
  await db.end().catch(() => undefined);
}
