# CCM-NONSAKA — boutique bio (TypeScript · PostgreSQL · PWA · notifications push)

Boutique en ligne + panneau d'administration (connexion, produits avec stock, commandes, notifications).

## Prérequis
- Node.js ≥ 22.13
- Un serveur PostgreSQL (≥ 14)

## Installation
```
npm install
copy .env.example .env      # puis renseignez DATABASE_URL (votre mot de passe PostgreSQL)
npm run dev                 # compile le client et lance le serveur en mode watch
```
- Boutique : http://localhost:3000 — Admin : http://localhost:3000/admin/
- Au premier lancement : la base `ccm_nonsaka` est créée si besoin (droit CREATEDB), les tables sont migrées automatiquement et le compte admin s'affiche dans la console (ou `ADMIN_EMAIL` / `ADMIN_PASSWORD` dans `.env`).
- `SEED_DEMO=0` pour ne pas créer les produits d'exemple.

## Production
```
npm run build               # vérifie les types, compile le client et le serveur
npm start                   # node dist/server.js (lit .env)
```
- Mettre `NODE_ENV=production` derrière un proxy **HTTPS** (obligatoire pour les notifications push, l'installation PWA et les cookies `secure`).
- Sauvegardez la base PostgreSQL (les clés push et le secret de session y sont stockés) et le dossier `uploads/` (photos).

## Structure
```
src/shared/   types partagés client/serveur
src/server/   API Express + PostgreSQL (db.ts : migrations, routes/, push.ts, security.ts)
src/client/   shop/ (boutique), admin/ (panneau), sw.ts (service worker)
public/       HTML, CSS, icônes, manifest — les bundles JS sont générés dans public/assets/
scripts/      build.ts, make-icons.ts, dev-db.ts
```

## Développement sans PostgreSQL installé
`npm run db:dev` lance une base PostgreSQL jetable (PGlite) sur le port 15433 :
```
DATABASE_URL=postgres://postgres:postgres@localhost:15433/postgres DB_POOL_MAX=1 npm run dev
```
(`DB_POOL_MAX=1` est nécessaire avec PGlite, qui n'a qu'une seule session.)

## Commandes utiles
`npm run typecheck` · `npm run icons` (régénère les icônes PWA)

## Sécurité
Voir [SECURITY-AUDIT.md](SECURITY-AUDIT.md) (audit, failles corrigées, risques résiduels, check-list de mise en production) et `npm run test:security` (tests d'attaque sur une instance locale de test).
Après une mise à jour du code, les sessions admin existantes sont invalidées : reconnectez-vous.

## Configuration de production
Copiez/adaptez `.env.production` (ignoré par git, jamais envoyé sur GitHub), puis `npm run build && npm run start:prod`.
Avant le premier lancement : créez l'utilisateur PostgreSQL dédié (commandes en tête du fichier) et mettez l'hôte réel dans `DATABASE_URL`.

## Mot de passe oublié (admin)
Page `/admin/forgot.html` (lien sur la page de connexion) : l'admin saisit son email, reçoit un **code à 6 chiffres** (valable 10 min, 5 essais, usage unique), puis choisit un nouveau mot de passe ; toutes les sessions ouvertes sont fermées.
- Configurez l'envoi d'emails (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`) — exemple Gmail dans `.env.example`. Sans SMTP : en développement le code s'affiche dans la console, en production **aucun email ne part**.
- L'email de l'admin doit être une vraie boîte mail : modifiable dans Admin > Mon compte.

## Mise en ligne
Voir [DEPLOY.md](DEPLOY.md) : Render (Starter) + Neon + nom de domaine, avec `render.yaml` prêt à l'emploi. Les photos produits sont stockées dans la base de données (elles survivent aux redéploiements).

## Skill « web-security-audit » (réutilisable)
`.claude/skills/web-security-audit/` : méthode d'audit de sécurité, règles d'engagement, scripts génériques (reconnaissance, scan de secrets Git, limitation de débit derrière un proxy, charge légère, faux SMTP, faux service push), catalogue des failles rencontrées et exemples complets. Installation pour tous vos projets : `node .claude/skills/web-security-audit/install.mjs`.
