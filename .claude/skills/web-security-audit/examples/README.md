# Exemples réels (projet CCM-NONSAKA : Express + PostgreSQL)

Ces batteries ont servi aux audits n°1 à 3. Elles sont **liées aux routes et champs de CCM-NONSAKA** (`/api/admin/*`, `/api/orders`, cookie `adm`/`__Host-adm`…) : copiez-les dans votre projet et adaptez chemins, champs, compte de test.

| Fichier | Cible | Ce qu'il prouve |
|---|---|---|
| `attack-1.mjs` | **local** | en-têtes, 16 routes admin sans session, cookies falsifiés, SQLi, XSS stocké, uploads piégés, traversée, CSRF, logique de commande, survente concurrente |
| `attack-2.mjs` | **local** | SSRF push, limites de débit, sessions révoquées, erreurs, taille, force brute (verrouille le compte de test : relancer le serveur ensuite) |
| `destructive-local.mjs` | **local uniquement** (refuse toute base non locale) | DROP/TRUNCATE dans les champs, suppressions, concurrence, débordements, NUL, géants, uploads massifs |
| `reset-e2e.mjs` | local + faux SMTP | « mot de passe oublié » de bout en bout |
| `push-e2e.mjs` | local + faux service push | notifications chiffrées, VAPID, 410 → nettoyage |
| `images-e2e.mjs` | local | photos stockées en base, cache, nettoyage |
| `remote-scan.mjs` | site déployé (non destructif) | 25 contrôles : en-têtes, routes protégées, SSRF, CSRF, commandes invalides, verrous par compte, limitation par IP |

Pour la résilience (pannes injectées), voir la section 4 de `SKILL.md` : triggers PostgreSQL qui lèvent une exception (`CREATE TRIGGER … BEFORE INSERT … RAISE EXCEPTION`), arrêt/redémarrage de la base pendant le service, migration sabotée par une table préexistante.
