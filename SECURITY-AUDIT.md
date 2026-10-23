# Audit de sécurité — CCM-NONSAKA

Date : 23 octobre 2026 · Périmètre : code du dépôt (serveur Express/TypeScript, client, PWA, base PostgreSQL) · Cible des tests : instance **locale** de test uniquement.

## 1. Méthode et limites

- **Revue de code** de tout le serveur (authentification, sessions, SQL, uploads, push, en-têtes) et du client (rendu HTML).
- **Tests d'attaque exécutés** contre une instance locale (46 scénarios, `tests/security/`) : en-têtes, accès sans session, falsification de cookies, injections SQL, XSS stocké, uploads piégés, traversée de chemins, CSRF, abus de commande, survente de stock, SSRF, force brute, énumération, révocation de sessions, erreurs et limites de taille.
- **Dépendances** : `npm audit` → 0 vulnérabilité connue (à relancer régulièrement).
- **Vérification dans le navigateur** : un produit et une commande contenant des balises `<script>` / `<img onerror>` s'affichent comme du texte, dans la boutique comme dans l'admin (aucune exécution).

**Ce que cet audit ne couvre pas / n'a pas pu tester**
- Votre serveur PostgreSQL réel (mots de passe inconnus) : les tests ont tourné sur PGlite, un PostgreSQL local à session unique. Le test de survente (12 commandes simultanées pour 3 unités → exactement 3 acceptées) valide la logique mais pas la contention réelle des verrous `FOR UPDATE`.
- HTTPS en production (cookies `Secure`/`__Host-`, HSTS), l'envoi réel des notifications push, l'hébergeur et le pare-feu.
- Aucun test d'intrusion externe, ni analyse du poste ou de l'hébergement. Aucun audit ne prouve l'absence totale de faille.

## 2. Failles trouvées et corrigées

| # | Sévérité | Faille (preuve avant correctif) | Correctif | Vérifié après |
|---|---|---|---|---|
| 1 | **Haute** | Le blocage de force brute se contournait en changeant l'en-tête `X-Forwarded-For` (30 tentatives sur 30 évaluées) : `trust proxy` était codé en dur | Proxy de confiance configurable (`TRUST_PROXY`, 0 en dev, 1 en prod) + **verrou par compte** (8 échecs/15 min) en plus du verrou par IP | 3/30 évaluées |
| 2 | **Haute** | **SSRF** : le serveur appelait n'importe quelle URL HTTPS fournie comme « endpoint push » (`127.0.0.1`, `169.254.169.254` acceptés) | Liste blanche des vrais services push (Google FCM, Mozilla, Windows, Apple), refus des identifiants/ports, contrôle des clés (65 et 16 octets) | refusé (400), vrai FCM accepté |
| 3 | Moyenne | Sessions **non révocables** : un cookie copié restait valide après déconnexion ou changement de mot de passe | Sessions en base (empreinte SHA-256 seulement), révocation à la déconnexion, et des autres sessions au changement de mot de passe | 401 après logout ; autres sessions révoquées |
| 4 | Moyenne | Accaparement du stock par commandes fictives en série (revue de code) | Maximum 3 commandes en attente par numéro de téléphone sur 24 h (en plus de 10/IP/10 min) | 4ᵉ commande refusée (429) |
| 5 | Moyenne | Inscriptions push illimitées (60/60 acceptées) et suivi de commande sans limite (150/150) → remplissage de la base, énumération des codes | 20 inscriptions/h et 30 suivis/min par IP, plafond global 600 req/min/IP | 20/60 et 30/150 |
| 6 | Basse | Aucun contrôle de l'origine sur les écritures (CSRF, atténué par `SameSite=Strict`) | Rejet des écritures `Origin` ≠ site ou `Sec-Fetch-Site: cross-site` | 403 |
| 7 | Basse | CSP `connect-src https:` trop large, `img-src data:` inutile | `connect-src 'self'`, `img-src 'self'`, `font-src 'self'` | vérifié |
| 8 | Basse | Limiteurs en mémoire sans purge (épuisement mémoire par clés uniques) | Purge périodique + plafond de 20 000 clés | revue de code |
| 9 | Basse | `ADMIN_PASSWORD` initial sans longueur minimale | Refus de démarrer sous 10 caractères ; mot de passe généré plus long (16 car.) | revue de code |

Durcissements ajoutés en plus : cookie `__Host-` en production, en-tête `Permissions-Policy`, **journal d'audit JSON** (connexions réussies/échouées/bloquées, changements de statut, suppressions, CSRF bloqués).

## 3. Contrôles vérifiés comme corrects (aucune faille trouvée)

- 16 routes admin refusent toute requête sans session ; cookies falsifiés (signature vide, aléatoire, identifiant modifié, jeton type « alg none ») rejetés.
- **Injections SQL** : requêtes toutes paramétrées ; payloads dans login, suivi, `limit`, champs de commande sans effet (pas de 500, pas de délai `pg_sleep`, tables intactes).
- **XSS** : sortie échappée côté client, JSON embarqué dans la page neutralisé (`<` échappé) ; test navigateur négatif.
- **Uploads** : type vérifié par la signature du fichier (HTML/PHP/SVG refusés, MIME mensonger ignoré), nom aléatoire côté serveur, 3 Mo max, servi avec `nosniff`.
- **Traversée de chemins** : 13 variantes (`..`, `%2e%2e`, `%5c`, `.env`, `src/`, `node_modules`…) sans fuite.
- **Logique métier** : quantités négatives/décimales/énormes, ids invalides, prix et total envoyés par le client (ignorés) → tout refusé ou ignoré ; stock jamais négatif, contrainte `CHECK` en base.
- Pas de CORS ouvert, erreurs génériques sans trace de pile, corps JSON limité à 50 Ko, JSON très imbriqué sans crash.

## 4. Risques résiduels (à connaître)

1. **Verrou de compte** : 8 échecs de connexion bloquent le compte 15 min (même avec le bon mot de passe) — protection contre la force brute distribuée, au prix d'un déni de service possible sur l'admin. Un redémarrage du serveur lève le blocage.
2. **Limiteurs en mémoire** : remis à zéro au redémarrage, non partagés entre plusieurs instances (utiliser Redis si vous passez à plusieurs serveurs).
3. **Pas de MFA** pour l'administrateur : à ajouter avant d'exposer des données sensibles (mots de passe uniques et longs en attendant).
4. Pas de CAPTCHA sur la commande : le spam est limité (IP, téléphone) mais pas impossible.
5. Le secret de session et les clés push sont dans la table `settings` : une fuite de la base permettrait de forger des cookies (les sessions sont toutefois vérifiées en base, donc un faux cookie sans session enregistrée reste refusé). Possibilité de fournir `SESSION_SECRET` par variable d'environnement.
6. Hachage `scrypt` aux paramètres par défaut de Node (acceptable) ; à renforcer si la base fuit.

## 5. Check-list avant mise en production

- [ ] Héberger **derrière HTTPS** avec `NODE_ENV=production` (active cookies `Secure`/`__Host-`, HSTS, proxy de confiance).
- [ ] Régler `TRUST_PROXY` : `1` derrière un proxy (nginx, Render, Railway), `0` si exposé directement.
- [ ] Créer un **utilisateur PostgreSQL dédié** (pas `postgres`) avec les seuls droits sur la base de l'app ; mot de passe long ; base non exposée à Internet.
- [ ] Mot de passe admin long et unique, fichier `.env` jamais versionné ni partagé.
- [ ] Sauvegardes de la base et du dossier `uploads/`, **restauration testée**.
- [ ] `npm audit` et mises à jour régulières ; surveiller le journal d'audit (`login_blocked`, `csrf_blocked`, `rate_limited`).
- [ ] Rejouer `npm run test:security` sur une instance de test après chaque évolution sensible.

## 6. Rejouer les tests

```
# instance de test locale (jamais la production)
TRUST_PROXY=1 ADMIN_PASSWORD=<mot-de-passe-de-test-long> PORT=3100 npm run dev
AUDIT_PW=<même-mot-de-passe> npm run test:security
```
Les scripts ne ciblent que `localhost`. La phase 2 verrouille volontairement le compte de test (test de force brute) : redémarrez le serveur ensuite.
