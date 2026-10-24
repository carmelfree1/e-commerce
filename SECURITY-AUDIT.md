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

---

# Audit n°2 — site déployé (Render + Neon + Cloudflare)

Date : 24 octobre 2026 · Cible : `https://ccm-nonsaka.onrender.com` · Méthode : 24 contrôles **non destructifs** (`tests/security/remote-scan.mjs`), reconnaissance, analyse du dépôt GitHub et de son historique. Aucune écriture en base, aucun email envoyé, aucun essai sur le vrai compte admin, pas de test de charge.

## Failles trouvées

| # | Sévérité | Constat (preuve) | Correctif |
|---|---|---|---|
| 1 | **Haute** | **La limitation de débit par IP ne fonctionne pas en production** : 34 requêtes de suivi de commande (limite 30/min) sont toutes passées. Derrière Render, `trust proxy=1` donne l'IP d'un relais interne, pas celle du visiteur : les compteurs par IP (commandes 10/10 min, suivi, inscriptions push, plafond global, blocage de connexion par IP) étaient inopérants. Seuls les verrous **par compte** (connexion, mot de passe oublié) fonctionnaient. | L'IP réelle est lue dans `CF-Connecting-IP` (posé par Cloudflare ; les clients ne peuvent pas le forger : Cloudflare renvoie une erreur 1000). Activé automatiquement sur Render (`RENDER=true`). **Vérifié sur le site en ligne après redéploiement** : premier 429 à la 31ᵉ requête (R1), `X-Forwarded-For` / `True-Client-IP` forgés sans effet (R2), `CF-Connecting-IP` forgé refusé par Cloudflare (R3), blocage de connexion par IP dès le 5ᵉ échec. Scan final : 25 contrôles sur 25 réussis. |
| 2 | Basse | La page 404 affichait « Cannot GET … » (signature d'Express). | Page 404 générique. |
| 3 | Moyenne (exposition) | **Le dépôt GitHub est public.** Le code n'expose aucun secret (vérifié sur tout l'historique), mais l'adresse email de l'administrateur est aussi l'email d'auteur des commits : l'identifiant de connexion est public (ciblage, hameçonnage, verrouillage du compte par 8 essais). L'ancien projet PHP est dans l'historique (`config.php` avec mot de passe de base **vide**, `database.sql` avec un compte administrateur d'exemple). | À faire par vous : dépôt en **privé**, adresse admin **différente** de l'email de commit, email de commit « noreply » GitHub. Voir la section ci-dessous. |

## Ce qui a résisté
- **TLS 1.2 et 1.3 uniquement**, HSTS (1 an), HTTP → HTTPS (301), CSP stricte, nosniff, Permissions-Policy, pas de X-Powered-By.
- **Aucun fichier sensible exposé** : `.env`, `.git`, `package.json`, `dist`, `src`, `*.map`, `render.yaml`, tests, scripts… tous en 404 (25 chemins testés).
- **Pare-feu Cloudflare** : les charges d'injection SQL sont bloquées en 403 avant même d'atteindre l'application ; l'en-tête `CF-Connecting-IP` forgé est refusé.
- 16 routes admin refusent l'accès sans session ; cookies falsifiés (`__Host-adm`) rejetés ; SSRF via abonnement push (8 variantes) refusé ; CSRF (Origin, Sec-Fetch-Site, text/plain) refusé ; pas de CORS ; commandes aberrantes refusées ; upload impossible sans connexion ; JSON malformé / trop gros / traversée de chemin sans fuite.
- Verrous par compte efficaces : connexion (429 dès le 9ᵉ échec) et mot de passe oublié (429 dès la 4ᵉ demande).

## Non testé (demande des identifiants ou serait destructif)
Fonctions admin authentifiées en ligne (XSS stocké avec de vraies données, upload avec session) — testées en local au premier audit ; commandes valides (écriture en base) ; charge / déni de service ; envoi réel d'emails ; sécurité de vos comptes GitHub, Render, Neon, Cloudflare/registrar (activez la **double authentification** partout) ; exposition réseau de la base Neon.

## À faire de votre côté (rien à coder)
1. **GitHub > Settings > General > Danger Zone > Change visibility > Private.** Render continue de déployer un dépôt privé.
2. **Changer l'email de connexion admin** pour une adresse non publique (Admin > Mon compte), différente de celle des commits.
3. **GitHub > Settings > Emails** : cocher « Keep my email addresses private » et « Block command line pushes that expose my email », puis `git config --global user.email "<identifiant>+carmelfree1@users.noreply.github.com"`. Les anciens commits gardent l'ancienne adresse sauf réécriture de l'historique.
4. Double authentification sur GitHub, Render, Neon, Cloudflare. Mot de passe admin long et unique.

---

# Audit n°3 — tests destructifs, résilience et charge

Date : 24 octobre 2026. Les tests **destructifs** ont été exécutés uniquement sur une **copie locale jetable** (base PGlite identique au schéma de production) : jamais sur le site en ligne, qui n'a reçu qu'un test de charge léger en lecture seule. Scripts : `tests/security/destructive-local.mjs`, `tests/security/light-load.mjs`.

## Défauts trouvés et corrigés

| # | Gravité | Constat | Correctif |
|---|---|---|---|
| 1 | Moyenne | **Dépassement d'entier → erreur 500** : prix ou stock > 2 147 483 647, montant de commande trop élevé (prix × quantité), identifiants d'URL ou d'articles énormes (`/products/99999999999`) faisaient échouer PostgreSQL. | Entiers bornés (`toInt` ≤ 2³¹−1), prix ≤ 10 M FCFA, stock ≤ 1 M, commande ≤ 2 Md FCFA, identifiants d'URL validés (404), totaux calculés en `float8`. |
| 2 | Moyenne | **Octet NUL (`\u0000`) → erreur 500** dans les noms, descriptions, champs de commande, code de suivi (`/api/orders/CCM%00X`) et URL d'abonnement push. | Texte nettoyé (`toStr`), format du code de suivi vérifié avant toute requête, caractères de contrôle refusés dans l'endpoint push. |
| 3 | Moyenne | **Panne de la base = boutique cassée** : la page d'accueil et le catalogue renvoyaient une erreur dès que la base était injoignable (panne, réveil de Neon). | Le dernier catalogue connu est servi pendant la panne (nouvelle tentative toutes les 5 s) ; la page se charge même sans catalogue. Reconnexion automatique vérifiée, sans redémarrage. |
| 4 | Basse | Les messages « Migration n appliquée » s'affichaient avant la validation de la transaction. | Affichés après le succès. |

## Résultats

**Destructif en local — 11/11** : chaînes `DROP/TRUNCATE` dans tous les champs sans effet ; suppression d'un produit sans perte de l'historique des commandes ; 12 annulations simultanées → stock restitué **une seule fois** ; 40 ajouts de stock simultanés → exactement +40 ; commandes et retraits concurrents → aucune unité perdue ni créée ; débordements numériques et caractères piégés → refus propres ; URL/en-têtes/cookies de 20 Ko ; 12 connexions + 6 changements de mot de passe simultanés → un seul mot de passe valide ; 20 photos de 600 Ko et 15 inscriptions push identiques en parallèle → tout accepté, une seule ligne d'abonnement.

**Résilience en local** : panne injectée au milieu d'une commande, d'une annulation ou d'une connexion → **tout est annulé** (stock inchangé, aucune commande orpheline, aucun verrou resté bloqué) ; migration cassée → **tout ou rien** (aucune table partielle) ; base coupée puis rallumée → dégradation propre (boutique et photos servies depuis le cache, écritures en 500 JSON) puis reprise automatique.

**Charge légère sur le site en ligne (lecture seule)** : 320 requêtes (4 en parallèle) → **320 réponses 200**, latence médiane 147 ms, p95 274 ms, santé intacte. Ce n'est pas un test de déni de service.

**Non-régression** : attaques 29/29, 17/17, photos 10/10, destructif 11/11 ; 0 erreur 500 côté serveur.

## Limites
La base de test (PGlite) n'a qu'une session : les tests de concurrence valident la logique (transactions, verrous `FOR UPDATE`) mais pas la contention réelle de Neon. Aucun test de déni de service (volontaire). Le site en ligne n'a subi aucun test destructif.
