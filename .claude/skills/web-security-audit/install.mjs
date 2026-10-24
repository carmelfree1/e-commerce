// Installe ce skill pour TOUS vos projets Claude Code : copie le dossier dans ~/.claude/skills/web-security-audit
// Usage : node install.mjs            (depuis ce dossier ou en donnant son chemin)
//         node install.mjs --project  (installe plutôt dans le projet courant : ./.claude/skills)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.dirname(fileURLToPath(import.meta.url));
const name = path.basename(src);
const dest = path.join(process.argv.includes('--project') ? path.join(process.cwd(), '.claude', 'skills') : path.join(os.homedir(), '.claude', 'skills'), name);

if (path.resolve(src) === path.resolve(dest)) { console.log(`Déjà au bon endroit : ${dest}`); process.exit(0); }
fs.mkdirSync(path.dirname(dest), { recursive: true });
const existed = fs.existsSync(dest);
fs.cpSync(src, dest, { recursive: true, force: true });
console.log(`${existed ? 'Mis à jour' : 'Installé'} : ${dest}`);
console.log('Redémarrez Claude Code (ou ouvrez une nouvelle session) ; le skill « web-security-audit » apparaît dans la liste des skills.');
