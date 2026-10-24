# Modèle de rapport d'audit

```markdown
# Audit de sécurité — <projet>
Date · Cible (URL / copie locale) · Méthode · Ce qui a été fait / ce qui ne l'a PAS été

## Synthèse (5 lignes max)
Résultat global, nombre de contrôles et de réussites, 1–3 points qui comptent vraiment.

## Défauts trouvés
| # | Gravité | Constat (preuve : commande + résultat) | Correctif | Vérifié après |
|---|---|---|---|---|
Gravité : Critique / Haute / Moyenne / Basse / Info — exploitable + impact d'abord.
Statut de chaque ligne : vérifié / supposé / non testable.

## Ce qui a résisté (avec le nombre de variantes testées)

## Non testé et pourquoi
(destructif en ligne, charge/DoS, comptes tiers, contention réelle de la base, envois réels d'emails…)

## Risques résiduels et compromis
(ex. verrou de compte = déni de service possible sur l'admin ; limiteurs en mémoire non partagés entre instances)

## À faire côté propriétaire
(dépôt privé, 2FA, rotation de secrets, mots de passe de base, sauvegardes testées…)

## Check-list de mise en production (statut explicite pour chaque ligne)

## Comment rejouer
Commandes exactes (scripts, variables d'environnement, avertissements « local uniquement »).
```

Règles : chiffres réels uniquement ; pas d'adjectif sans mesure ; distinguer « corrigé en local » de « vérifié en ligne » ; jamais de secret dans le rapport.
