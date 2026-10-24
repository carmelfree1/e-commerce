# Catalogue des défauts réellement rencontrés (projet CCM-NONSAKA : Express + PostgreSQL + PWA, hébergé sur Render/Neon/Cloudflare)

Utilisez-le comme liste de **ce qui casse vraiment** : chaque ligne a été trouvée par un test, corrigée, puis re-testée.

## Sécurité applicative
| Défaut | Comment on l'a trouvé | Correctif |
|---|---|---|
| **Force brute contournable** : verrou de connexion par IP seule, IP lue dans `X-Forwarded-For` (`trust proxy` codé en dur) | 30 tentatives avec 30 fausses IP, toutes évaluées | `TRUST_PROXY` configurable + verrou **par compte** (8/15 min) en plus du verrou par IP |
| **SSRF** via `endpoint` d'abonnement push (le serveur POSTe vers l'URL du client) | `https://127.0.0.1:9/x` et `169.254.169.254` acceptés | liste blanche : `fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`, `*.push.apple.com` ; refus `user:pass@`, ports ≠ 443, caractères de contrôle |
| **Sessions non révocables** (cookie signé sans état) | cookie copié valide après déconnexion et changement de mot de passe | table `admin_sessions` (empreinte SHA-256), suppression à la déconnexion, révocation des autres sessions au changement de mot de passe |
| Inscriptions push / suivi de commande **sans limite** | 60/60 et 150/150 requêtes acceptées | 20/h et 30/min par IP, plafond global 600/min |
| Pas de contrôle de **l'origine** des écritures | POST avec `Origin: https://evil.example` accepté | rejet si `Origin` ≠ hôte ou `Sec-Fetch-Site: cross-site` |
| CSP `connect-src https:` trop large, `img-src data:` inutile | lecture des en-têtes | `connect-src 'self'`, `img-src 'self'` |
| Limiteurs en mémoire sans purge | revue de code | purge périodique + plafond de clés |
| Accaparement du stock par commandes fictives | revue + test | ≤ 3 commandes en attente par numéro de téléphone / 24 h |
| Mot de passe admin initial sans minimum | revue | refus de démarrer sous 10 caractères |
| 404 « Cannot GET » (signature Express) | `GET /inexistant` | page 404 générique |

## Robustesse (jamais de 500)
| Défaut | Déclencheur | Correctif |
|---|---|---|
| Dépassement d'entier 32 bits | prix/stock/id > 2 147 483 647, prix × quantité, `SUM(total)::int` | `toInt` borné, plafonds métier, total ≤ 2 Md, `::float8` pour les sommes |
| Octet NUL | `\u0000` dans un nom, un champ de commande, `/api/orders/CCM%00X`, URL de l'abonnement (JSONB) | `toStr` retire les NUL, format du code de suivi validé avant la base, caractères de contrôle refusés |
| Identifiants d'URL invalides | `/products/abc`, `/products/99999999999`, `/orders/-5` | `idParam()` → 404 |
| Base indisponible = boutique entière en erreur | arrêt de la base pendant le service | dernier catalogue connu servi (nouvelle tentative toutes les 5 s) ; page d'accueil sans catalogue plutôt qu'une erreur |

## Capacité
| Piège | Constat | Réglage |
|---|---|---|
| **Réseaux mobiles partagés (CGNAT)** : de nombreux clients sous une même IP publique | des limites par IP basses (10 commandes/10 min, 600 req/min) bloqueraient des clients légitimes | limites généreuses pour les actions clients, strictes pour l'administration, centralisées dans un seul fichier ; ne pas compter les lectures de catalogue en cache |
| **Base serverless à heures de calcul limitées** (ex. Neon gratuit : 100 h/mois, veille après 5 min) | toute requête réveille la base : onglet admin qui interroge toutes les 30 s, cache catalogue de 5 s, sonde de santé → la base ne dort jamais, quota épuisé en 2–3 semaines | cache catalogue long **vidé à chaque écriture**, interrogation admin ≥ 2 min, `/healthz` sans base, alertes par push |
| CDN de l'hébergeur qui ne met rien en cache (`cf-cache-status: DYNAMIC`) | chaque fichier statique passe par Node | en-têtes `immutable` + ETag (les navigateurs gardent 1 an), mesurer le débit (`benchmark local`) avant de promettre une capacité |

## Déploiement (PaaS) et configuration
| Piège | Symptôme | Correctif |
|---|---|---|
| **IP cliente derrière Render/Cloudflare** | limitation par IP inactive (34/34 requêtes passent) | lire `CF-Connecting-IP` (posé par Cloudflare, falsification refusée en 403 « erreur 1000 ») ; activé automatiquement si `RENDER=true` ; toujours revalider avec `rate-limit-probe` |
| `npm install` sans devDependencies | `TS2688: Cannot find type definition file for 'node'` | outils de build (`typescript`, `tsx`, `esbuild`, `@types/*`) en `dependencies` |
| Node non épinglé (`>=22.13`) | l'hébergeur prend Node 26 | `"engines": { "node": "22.x" }` |
| Poolers (Neon/PgBouncer) | `pg_advisory_lock` de session peu fiable | migrations dans **une** transaction avec `pg_advisory_xact_lock` ; tout-ou-rien prouvé |
| `sslmode=require` | avertissement `pg` à chaque démarrage | écrire `sslmode=verify-full` explicitement |
| Sonde de santé qui interroge la base | une base serverless ne s'endort jamais (heures de calcul) | `/healthz` sans accès base |
| Disque éphémère | photos perdues à chaque déploiement | photos en base (`bytea`, cache mémoire, nettoyage des orphelines) ou stockage objet |
| SMTP bloqué sur l'offre gratuite de l'hébergeur | emails de reset jamais envoyés | plan payant ou service d'envoi (Brevo, Resend, Mailgun) |
| DNS chez Cloudflare + Render | certificat jamais émis | enregistrements en **nuage gris** (DNS only), pas d'AAAA |
| Dépôt public | email d'auteur = identifiant admin ; ancien projet dans l'historique | dépôt privé, email « noreply », ne jamais réutiliser l'email de commit comme identifiant |

## Pièges **de test** (ne pas confondre avec des failles)
- Un test qui révoque les sessions (changement de mot de passe) fait échouer les tests suivants qui réutilisent le cookie : se reconnecter.
- Un verrou par compte déclenché par un test bloque les tests suivants : redémarrer le serveur (compteurs en mémoire).
- Une base de test à session unique (PGlite) sérialise les requêtes : la logique de concurrence est validée, pas la contention réelle.
- Tuer le serveur de test sans relancer la base laisse une connexion fantôme : relancer les deux.
- Derrière un CDN, un 403 sur une charge SQLi vient du pare-feu : c'est une protection, pas une panne ; adapter le test.
- Curl/Git Bash déforme les accents des données de test (octets invalides) : ce n'est pas un bogue d'encodage de l'application.
- **Git Bash sous Windows** réécrit toute valeur ressemblant à un chemin Unix (`RATE_PATH=/api/x` devient `C:/Program Files/Git/api/x`) → `ERR_UNESCAPED_CHARACTERS` : préfixer par `MSYS_NO_PATHCONV=1` ou utiliser PowerShell (les scripts du skill réparent le cas courant).
- Les heredocs shell avec apostrophes/backticks cassent facilement : écrire les scripts avec un outil de fichier.
