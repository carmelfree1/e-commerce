# Mise en ligne — Render (Starter) + Neon + nom de domaine

Architecture : **Render** héberge l'application (toujours allumée), **Neon** héberge la base PostgreSQL (déjà créée et migrée), le **registrar** vend le nom de domaine. Les photos produits sont dans la base : elles survivent aux redéploiements.

> Les prix ci-dessous viennent de relevés web d'octobre 2026 : **vérifiez-les au moment d'acheter**.

## 1. Choisir le nom de domaine (budget 16 $)

| Extension | 1re année | Renouvellement | Avis |
|---|---|---|---|
| `.xyz` | ≈ 1 $ | ≈ 14 $ | Le moins cher pour démarrer, renouvellement correct |
| `.com` | ≈ 10,5 $ | ≈ 10,5 $ (Cloudflare) / ≈ 11 $ (Porkbun) | Le plus crédible et le moins cher à long terme, mais dépasse un peu le budget avec Render |
| `.shop` | ≈ 1–2 $ | **≈ 31 $** | Piège : très cher dès la 2ᵉ année |
| `.site` | ≈ 2 $ | **≈ 29 $** | Piège : très cher dès la 2ᵉ année |
| `.ci` | variable | variable | Prix flou (9 000 FCFA à plusieurs dizaines de milliers), bureau d'enregistrement accrédité exigé |

**Conseil :** `.xyz` pour démarrer (≈ 1 $ + Render 7 $/mois = environ 2 mois d'hébergement avec 16 $). Quand les ventes arrivent, passez à un `.com` au premier renouvellement. **Regardez toujours le prix de renouvellement avant d'acheter.**
Où acheter : **[Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)** (recommandé : vendu au prix coûtant, sans marge, `.com` ≈ 10,5 $ par an, la gestion DNS est incluse et gratuite) ou [Porkbun](https://porkbun.com) (Namecheap accepte aussi PayPal). Tous les suffixes ne sont pas proposés par Cloudflare (par ex. `.xyz` : à vérifier dans la barre de recherche du tableau de bord). Activez la double authentification sur ce compte.

> **Peut-on tout faire chez Cloudflare ?** Le domaine, le DNS, le HTTPS et la protection : oui. Héberger *cette* application (Node.js + PostgreSQL) : pas simplement. Cloudflare Pages ne sert que des sites statiques ; Workers impose de réécrire le serveur ; Cloudflare Containers (en bêta, forfait « Workers Paid » 5 $/mois + consommation) peut faire tourner un conteneur, mais il se met en veille après inactivité (réveil de quelques secondes) et son disque est effacé à chaque mise en veille. D'où le choix : **domaine chez Cloudflare + application sur Render**.

## 2. Créer le service sur Render
1. Créez un compte sur [render.com](https://render.com), ajoutez un moyen de paiement (carte). Activez la double authentification.
2. **New > Blueprint**, autorisez l'accès au dépôt GitHub `carmelfree1/e-commerce`, branche `main`. Render lit `render.yaml`.
3. Renseignez les variables demandées (copiez les valeurs depuis votre fichier local `.env.production`, **jamais dans un chat ou un email**) :
   - `DATABASE_URL` : l'URL Neon (version « pooled »).
   - `ADMIN_EMAIL` : l'email de l'administrateur.
   - `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` : l'envoi des emails « mot de passe oublié » (Gmail + mot de passe d'application).
   - Inutile de renseigner `ADMIN_PASSWORD` : le compte admin existe déjà dans Neon.
4. Validez : Render compile (`npm ci && npm run build`) puis démarre. Premier déploiement : 3 à 6 minutes.
5. Ouvrez l'adresse `https://ccm-nonsaka.onrender.com` (ou celle affichée) : la boutique doit apparaître. Contrôle de santé : `/healthz` répond `ok`.

> Le plan Starter est payant, ce qui lève aussi le blocage des ports SMTP (587/465) appliqué par Render aux services gratuits. Si l'envoi d'emails échoue malgré tout, utilisez un service d'envoi (Brevo, Resend, Mailgun) à la place de Gmail.

## 3. Relier le nom de domaine
1. Render > votre service > **Settings > Custom Domains** > ajoutez `votredomaine.xyz` **et** `www.votredomaine.xyz`.
2. Dans la zone DNS (chez Cloudflare : tableau de bord > votre domaine > **DNS > Records**) :
   - Enregistrement **A** : nom `@` → `216.24.57.1`
   - Enregistrement **CNAME** : nom `www` → `ccm-nonsaka.onrender.com` (l'adresse exacte de votre service)
   - **Supprimez tout enregistrement AAAA** (Render ne gère pas l'IPv6).
   - Chez Cloudflare, mettez le **nuage en gris** (« DNS only ») sur ces deux lignes : le nuage orange empêche Render de vérifier le domaine et d'émettre le certificat HTTPS.
3. Retour sur Render : **Verify**. Le certificat HTTPS est créé et renouvelé automatiquement (quelques minutes, parfois jusqu'à 1 h pour la propagation DNS).
4. **N'invitez vos clients que sur le vrai domaine** : les abonnements aux notifications push sont liés à l'adresse du site ; ceux pris sur `onrender.com` ne suivent pas.

## 4. Après la mise en ligne
- Connectez-vous à `/admin/`, changez le mot de passe (Mon compte), vérifiez l'email de récupération.
- Ajoutez vos produits (les photos sont réduites puis stockées dans Neon) et passez une commande de test.
- Testez « Mot de passe oublié » (le mail doit arriver) et les notifications (HTTPS requis : ok sur Render).
- Rejouez `npm run test:security` **uniquement sur une instance locale**, jamais sur le site en ligne.

## 5. Coûts et limites à surveiller
- **Render Starter** : 7 $/mois. La facturation suit le temps d'utilisation (voir votre page Billing).
- **Neon gratuit** : la base se met en veille après quelques minutes d'inactivité (réveil ≈ 1–2 s) et le temps de calcul gratuit est limité. `/healthz` n'interroge pas la base pour ne pas la maintenir éveillée. Surveillez la consommation dans la console Neon.
- **Photos** : limitées à 300 Mo au total par l'application (la base gratuite Neon offre 0,5 Go pour tout). Les photos non utilisées depuis plus de 24 h sont supprimées automatiquement.
- **Sauvegardes** : vérifiez la durée de restauration offerte par votre plan Neon et faites un export `pg_dump` de temps en temps.
- **Mises à jour** : chaque `git push` sur `main` redéploie automatiquement (`autoDeploy`). Les migrations de base s'appliquent toutes seules au démarrage.

## 6. Dépannage rapide
| Symptôme | Cause probable |
|---|---|
| Le build échoue | Voir les journaux Render ; `npm run build` doit réussir en local |
| Page blanche / erreur 502 | Le service n'a pas démarré : regardez les journaux (variable `DATABASE_URL` manquante ou fausse) |
| Impossible de se connecter à l'admin | Le cookie de session exige **HTTPS** : utilisez l'adresse `https://` |
| Le mail « mot de passe oublié » n'arrive pas | `SMTP_PASS` (mot de passe d'application Gmail) incorrect, ou spams |
| Le domaine ne se vérifie pas | Enregistrement AAAA restant, nuage Cloudflare orange, ou propagation DNS en cours |

## 7. Capacité et plan gratuit de Neon
- **Serveur (Render Starter : 0,5 CPU, 512 Mo)** : mesure locale en mode production ≈ 590 pages d'accueil/s, ≈ 850 fichiers statiques/s, ≈ 1 200 appels catalogue/s sur une machine de 2015 (ordres de grandeur ; divisez par 2 à 4 par prudence). Cela correspond à **quelques centaines de visiteurs simultanés** et plusieurs dizaines de milliers de visites par jour.
- **Le vrai plafond est le calcul gratuit de Neon** (100 heures de calcul par projet et par mois, mise en veille après 5 minutes sans requête). Réglages qui économisent ces heures :
  - le catalogue est gardé **10 minutes** en mémoire (`CATALOG_CACHE_SECONDS`) et vidé à chaque commande ou modification : les visites n'interrogent pas la base ;
  - le panneau admin n'interroge le serveur que toutes les **2 minutes** (les notifications push donnent l'alerte immédiate) : **évitez de laisser un onglet admin ouvert en permanence**, il garde la base éveillée ;
  - `/healthz` n'interroge pas la base.
- **Limites par IP** (réseaux mobiles partagés : plusieurs clients derrière une même IP) : 30 commandes/10 min, 120 suivis/min, 60 inscriptions push/h, 1 200 requêtes API/min (le catalogue en lecture n'est pas compté). Les actions d'administration restent strictes. Tout est dans `src/server/limits.ts`.
- Le CDN devant Render **ne met pas en cache** les fichiers statiques (`cf-cache-status: DYNAMIC`) : chaque fichier est servi par Node ; les navigateurs les gardent 1 an après la première visite. Surveillez la consommation dans la console Neon et le tableau de bord Render.
