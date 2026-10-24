# Check-list de revue et de test (une ligne = un test à exécuter)

Cocher chaque ligne avec une **preuve** (commande + résultat). « Non applicable » est une réponse valable si justifiée.

## Authentification et sessions
- [ ] Mots de passe hachés (scrypt/argon2/bcrypt, sel unique) ; comparaison à temps constant ; même coût de calcul si le compte n'existe pas.
- [ ] Verrou de connexion **par IP et par compte**, testé avec une adresse bidon ; les compteurs survivent-ils aux en-têtes d'IP falsifiés ?
- [ ] Cookie : `HttpOnly`, `Secure` (prod), `SameSite=Strict`, préfixe `__Host-` en prod ; durée limitée.
- [ ] Sessions **révocables** (table, empreinte SHA-256) : déconnexion et changement de mot de passe invalident ; test avec un cookie copié.
- [ ] Jetons/cookies falsifiés (signature vide, aléatoire, modifiée, `alg:none`) → 401 ; id/payload modifié → 401.
- [ ] Reset de mot de passe : réponse identique compte existant/inexistant ; code aléatoire (CSPRNG), haché, court (10 min), essais limités (5), usage unique, un seul code actif ; limites par adresse et par IP ; sessions révoquées ensuite.
- [ ] Mot de passe initial fort (longueur minimale) ; jamais en clair dans le dépôt.

## Autorisation
- [ ] **Chaque** route d'administration refuse sans session (lister toutes les routes, pas un échantillon).
- [ ] IDOR : un utilisateur ne lit/modifie pas les objets d'un autre (changer l'identifiant).
- [ ] Mass assignment : seuls les champs attendus sont lus ; statut/prix/rôle jamais pris du client.

## Entrées
- [ ] SQL : requêtes paramétrées partout ; payloads `' OR 1=1`, `; DROP`, `pg_sleep` dans chaque champ et paramètre → pas de 500, pas de délai.
- [ ] Entiers : bornes **avant** la base (≤ 2³¹−1 pour une colonne `integer`) ; totaux calculés côté serveur ; `SUM::int` évité.
- [ ] Texte : octet NUL, surrogates isolés, emojis, caractères directionnels ; longueurs bornées.
- [ ] Taille : JSON (ex. 50 Ko), uploads (ex. 3 Mo), URL/en-têtes/cookies géants → 4xx propre.
- [ ] Identifiants d'URL : `abc`, `-5`, `99999999999`, `%00` → 404/400, jamais 500.
- [ ] JSON malformé / profondément imbriqué → 400 sans trace de pile.

## Sorties et navigateur
- [ ] XSS : toute donnée affichée est échappée (`textContent` ou fonction d'échappement) ; données embarquées dans un `<script type="application/json">` avec `<` échappé ; vérification **dans un navigateur** avec `<script>`/`<img onerror>` stockés.
- [ ] CSP stricte (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`), HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, pas de `X-Powered-By`.
- [ ] Pas de CORS ouvert ; préflight depuis une origine étrangère sans `Access-Control-Allow-Origin`.
- [ ] CSRF : `SameSite=Strict` **et** contrôle `Origin`/`Sec-Fetch-Site` sur les écritures ; `text/plain` non interprété.

## Fichiers et ressources externes
- [ ] Upload : type vérifié par signature (pas MIME/extension), nom aléatoire serveur, taille limitée, servi avec `nosniff`, SVG refusé, pas d'exécution.
- [ ] Traversée de chemins : `..`, `%2e%2e`, `%5c`, `..%2f` sur toutes les routes de fichiers ; fichiers sensibles (`.env`, `.git`, `src/`, `*.map`, `package.json`) en 404.
- [ ] SSRF : toute URL fournie (webhook, abonnement push, image distante) passe par une **liste blanche de domaines** ; refuser `http`, IP privées, `169.254.169.254`, `user:pass@`, ports exotiques, faux domaines (`fcm.googleapis.com.evil.com`).
- [ ] Webhooks entrants : signature vérifiée + horodatage.

## Disponibilité et logique métier
- [ ] Limites de débit **par IP efficaces derrière le proxy réel** (`rate-limit-probe`) ; plafond global ; purge mémoire des compteurs.
- [ ] Concurrence : transactions + verrous de ligne ; N requêtes simultanées sur la même ressource → invariants conservés (stock jamais négatif, remboursements une seule fois).
- [ ] Anti-abus métier : commandes fictives en série (limite par téléphone/IP), accaparement de stock.
- [ ] Panne en cours de transaction → tout annulé ; base indisponible → dégradation propre puis reprise.

## Configuration et exploitation
- [ ] Secrets hors dépôt (`.gitignore` : `.env`, `.env.*`, `*.pem`), absents de **tout l'historique** (`secret-scan`), jamais dans les logs.
- [ ] `npm audit` propre ; Node et dépendances supportés ; version de Node épinglée.
- [ ] HTTPS forcé, TLS ≥ 1.2, `NODE_ENV=production`, proxy de confiance réglé (nombre de sauts ou en-tête du CDN).
- [ ] Journal d'audit (connexions, échecs, blocages, changements sensibles) sans données secrètes.
- [ ] Compte base **dédié** (pas superutilisateur), base non exposée sans mot de passe ; sauvegardes testées.
- [ ] Dépôt privé si le code n'a pas à être public ; email d'auteur des commits ≠ identifiant admin ; 2FA sur GitHub, hébergeur, base, registrar.
