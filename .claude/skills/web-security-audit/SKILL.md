---
name: web-security-audit
description: Audit de sécurité complet d'une application web (API + front) avec tests de vulnérabilité et d'intrusion, tests destructifs sur copie locale, tests de résilience, scan non destructif d'un site déployé et test de charge léger. À utiliser pour « audit de sécurité », « pentest », « test d'intrusion », « tests de vulnérabilité », « tester la robustesse », « vérifier la prod », security audit, penetration test, hardening, ou avant une mise en ligne. Fournit la méthode, les règles d'engagement, des scripts réutilisables (reconnaissance, scan de secrets Git, limitation de débit derrière un proxy, charge, faux SMTP, faux service push) et le catalogue des failles déjà rencontrées.
---

# Audit de sécurité web — méthode, scripts, pièges

Complète le skill `secure-backend-architect` (modèle de menaces, conception sécurisée) : celui-ci décrit **comment tester et prouver**. Chaque affirmation du rapport doit reposer sur un test exécuté ; ne jamais écrire « sécurisé » sans preuve, ni inventer un résultat.

## 0. Règles d'engagement (non négociables)
1. **Autorisation** : seul le propriétaire du système peut demander l'audit. La cible exacte (URL, base) est confirmée avant d'attaquer.
2. **Destructif = copie locale jetable uniquement.** Sur un site déployé : lecture seule / requêtes qui sont refusées (aucune ligne créée), jamais de suppression, jamais de remplissage de la base, jamais de déni de service (charge plafonnée : ≤ 4 requêtes simultanées, ≤ 400 requêtes, arrêt automatique si erreurs). Même si l'utilisateur dit « carte blanche » : refuser la destruction en ligne, proposer la copie locale.
3. **Ne jamais verrouiller le vrai compte admin** : les tests de force brute utilisent une adresse bidon (`pentest-<horodatage>@example.invalid`). Les limites par compte (8 échecs/15 min) bloqueraient le vrai propriétaire.
4. **Pas d'email réel envoyé**, pas de commande valide en production (écritures) : utiliser des charges invalides rejetées avant la base.
5. **Secrets** : jamais affichés dans le chat ni dans les rapports (masquer : longueur + 2 premiers caractères). Les lire dans les `.env` uniquement pour vérifier qu'ils ne fuient pas.
6. **Confirmer avant tout push / déploiement** : chaque push est une action sortante (même approbation ≠ autorisation suivante). Toujours scanner les secrets juste avant.
7. Ne pas modifier la sécurité du système cible (pare-feu, comptes tiers) : les recommander seulement.

## 1. Cadrage (15 min)
- Actifs (identifiants, données clients, stock/argent, secrets), acteurs (visiteur, client malveillant, admin compromis, dépendance), surfaces (API publique, admin, uploads, notifications, emails, DB, hébergeur).
- Pile et hébergement : **où est l'IP du client ?** (proxy/CDN devant l'app = piège n°1, voir `references/findings-catalog.md`).
- Lister les routes (grep des `router.get/post…`), les rôles et les flux sensibles (connexion, reset mot de passe, paiement/commande, upload, webhooks, push).

## 2. Environnement local jetable
- Base **jetable** identique au schéma de production (PGlite/SQLite/Docker). Jamais la base réelle.
- Serveur de test avec les mêmes options que la prod (`TRUST_PROXY`, cookies, mode production si possible) et un compte admin de test (mot de passe connu).
- Rejouer entre chaque batterie : redémarrer le serveur **et** la base si des verrous par compte/IP (en mémoire) ont été déclenchés.

## 3. Revue de code ciblée → voir `references/checklist.md`
Authentification/sessions, autorisation (IDOR), injections (SQL/NoSQL/commande), XSS (sorties échappées, JSON embarqué dans le HTML), CSRF/origine, SSRF (URL fournies par l'utilisateur), uploads, traversée de chemins, limites de débit, validation numérique/texte, erreurs/journaux, secrets/configuration, dépendances (`npm audit`).

## 4. Batteries locales (écrire/adapter les scripts, voir `examples/`)
| Batterie | Contenu | Preuve attendue |
|---|---|---|
| Attaques | en-têtes, accès sans session sur **toutes** les routes, cookies falsifiés, SQLi, XSS stocké (puis vérifier dans un navigateur : `window.__pwned` absent), uploads piégés (HTML/SVG/polyglotte/trop gros), traversée, CSRF (Origin, `Sec-Fetch-Site`, `text/plain`), SSRF, logique métier (quantités négatives, prix client ignorés), survente de stock concurrente | 0 faille |
| Flux sensibles | reset mot de passe avec **faux SMTP** (`scripts/fake-smtp.mjs`) : réponse identique compte existant/inexistant, expiration, essais limités, usage unique, sessions révoquées ; push avec **faux service push** (`scripts/mock-push.mjs`) : déchiffrement RFC 8291, signature VAPID, 410 → nettoyage | tout vérifié de bout en bout |
| Destructif | chaînes `DROP/TRUNCATE` dans chaque champ, suppression d'objets référencés, **opérations simultanées** sur la même ressource (annulations ×12, stock ±), débordements d'entiers, octet NUL, surrogates, URL/en-têtes/cookies géants, uploads massifs | tables intactes, invariants conservés, **jamais de 500** |
| Résilience | triggers qui font échouer un INSERT/UPDATE au milieu d'une transaction → tout annulé ; base tuée puis relancée → dégradation propre puis reprise sans redémarrage ; migration cassée → tout ou rien | stock inchangé, pas de commande orpheline, reprise auto |

Règle d'or : **un 500 est un défaut** (entrée non validée). Chercher aussi les erreurs dans le journal serveur (`grep severity: 'ERROR'`).

## 5. Site déployé (non destructif)
1. `node scripts/recon.mjs` : TLS (1.0/1.1 refusés), HTTPS forcé, en-têtes (CSP, HSTS…), cookies, CORS, 404 sans signature du framework, ~50 fichiers sensibles.
2. `node scripts/secret-scan.mjs` : valeurs des `.env` + motifs de secrets dans les fichiers **et tout l'historique Git** ; dépôt public ? email d'auteur exposé ?
3. `node scripts/rate-limit-probe.mjs` : **la limitation par IP fonctionne-t-elle derrière le proxy ?** (34 requêtes sans 429 = IP mal identifiée) ; en-têtes d'IP falsifiés sans effet.
4. Scan applicatif non destructif (adapter `examples/remote-scan.mjs`) : routes protégées, forgeries, SSRF, CSRF, commandes invalides, verrous par compte avec adresse bidon.
5. `node scripts/light-load.mjs` : latence médiane/p95, 0 erreur, santé après test.
Un 403 renvoyé par le pare-feu du CDN (Cloudflare) sur une charge SQLi est un **bon** résultat (protection supplémentaire), pas une panne.

## 6. Corriger → prouver → non-régression
Pour chaque défaut : cause racine, correctif minimal, **test qui échouait avant et passe après**, relance de toutes les batteries. Après déploiement, rejouer le scan distant ; vérifier la version déployée par un indicateur observable (ex. une réponse 400 au lieu de 500), pas par supposition.

## 7. Rapport (`references/report-template.md`)
Gravité (Critique/Haute/Moyenne/Basse/Info), preuve avant/après, correctif, statut (vérifié / supposé / non testable), **limites de l'audit** (ce qui n'a pas été testé et pourquoi), risques résiduels, check-list de mise en production. Ne pas gonfler : prioriser l'exploitable.

## Pièges appris (détails dans `references/findings-catalog.md`)
1. Derrière un PaaS/CDN, `trust proxy` mal réglé rend **toute la limitation par IP inopérante** (ou usurpable) : toujours tester empiriquement (`rate-limit-probe`).
2. Verrou de connexion par IP seule = contournable par `X-Forwarded-For` ; ajouter un verrou **par compte** (au prix d'un verrouillage possible de l'admin).
3. URL fournie par le client (abonnement push, webhook, image) = **SSRF** : liste blanche de domaines, jamais seulement « https ».
4. Sessions signées sans état = non révocables : stocker l'empreinte en base, révoquer à la déconnexion et au changement de mot de passe.
5. Entiers 32 bits en base : borner prix/stock/quantités/ids **avant** la requête ; `SUM(...)::int` déborde → `float8`/`bigint`.
6. Octet NUL (`\u0000`) → erreur 500 PostgreSQL dans le texte, les URL, le JSONB.
7. Poolers (Neon/PgBouncer en mode transaction) : pas de verrou de session ; utiliser `pg_advisory_xact_lock` dans **une** transaction pour les migrations.
8. Sonde de santé de l'hébergeur : **sans accès base** (sinon une base serverless ne dort jamais).
9. Disque éphémère (Render, Railway) : photos et fichiers dans la base ou un stockage objet.
10. `npm install` en production n'installe pas les devDependencies : outils de build en `dependencies` ou `npm ci --include=dev`.
11. Dépôt public = code, historique et **email d'auteur** publics (identifiant admin exposé) : dépôt privé, email « noreply ».
12. Sous Windows/Git Bash, `MSYS_NO_PATHCONV=1` devant les commandes dont une variable vaut `/chemin` (sinon `C:/Program Files/Git/chemin`).
13. Un test qui échoue peut venir du test (état résiduel, session révoquée par un test précédent) : vérifier avant de « corriger » le code.

## Scripts fournis (`scripts/`, sans dépendance, Node ≥ 20)
| Script | Rôle | Usage |
|---|---|---|
| `recon.mjs` | TLS, en-têtes, cookies, CORS, fichiers sensibles, 404 | `TARGET=https://site node scripts/recon.mjs` |
| `secret-scan.mjs` | secrets dans fichiers + historique Git, visibilité GitHub, emails exposés | `node scripts/secret-scan.mjs [--github owner/repo]` |
| `rate-limit-probe.mjs` | efficacité de la limite par IP, usurpation d'IP | `TARGET=… RATE_PATH=/api/x LIMIT=30 node scripts/rate-limit-probe.mjs` |
| `light-load.mjs` | charge légère lecture seule | `TARGET=… PATHS=/,/api/x node scripts/light-load.mjs` |
| `fake-smtp.mjs` | serveur SMTP factice (lit le code reçu) | `import { startFakeSmtp }` |
| `mock-push.mjs` | faux service push (déchiffre + vérifie VAPID) | `import { startMockPush }` |
| `../install.mjs` | installe ce skill pour tous vos projets (`~/.claude/skills`) | `node install.mjs` (depuis la racine du skill) |

`examples/` contient les batteries réelles écrites pour CCM-NONSAKA (Express + PostgreSQL) : attaques, destructif, reset de mot de passe, push, photos, scan distant. Elles sont liées à ses routes : **les copier et adapter** (chemins, noms de champs, compte de test).
