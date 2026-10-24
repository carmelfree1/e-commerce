/**
 * Limites de débit par IP (fenêtre glissante). Elles sont volontairement REGROUPÉES ici.
 *
 * Contexte : en Côte d'Ivoire (et ailleurs) les opérateurs mobiles partagent une même adresse IP publique entre un grand nombre
 * d'abonnés (CGNAT). Une limite trop basse sur une action de client légitime bloquerait des dizaines de clients à la fois.
 * Règle suivie :
 *  - actions des CLIENTS (parcourir, suivre, commander, s'abonner) : limites généreuses, la vraie protection étant ailleurs
 *    (3 commandes en attente par téléphone, stock, validation) ;
 *  - actions d'ADMINISTRATION sensibles (connexion, mot de passe oublié) : limites strictes par IP ET par compte.
 */
const min = 60_000, hour = 60 * min;

export const LIMITS = {
  /** Toutes les routes /api (sauf le catalogue en lecture, voir app.ts). */
  api: { max: 1200, windowMs: min },
  /** Commandes : ≈ 30 clients derrière une même IP mobile peuvent commander en 10 minutes. */
  order: { max: 30, windowMs: 10 * min },
  /** Suivi de commande (anti-énumération des codes : 120 essais/min ne permettent pas de deviner un code de 6 caractères). */
  track: { max: 120, windowMs: min },
  /** Inscriptions aux notifications (une par appareil client). */
  subscribe: { max: 60, windowMs: hour },
  /** Connexion admin : échecs par IP (large : la protection principale est le verrou par compte) et par compte. */
  loginIp: { max: 10, windowMs: 15 * min },
  loginAccount: { max: 8, windowMs: 15 * min },
  /** Mot de passe oublié. */
  forgotIp: { max: 5, windowMs: hour },
  forgotAccount: { max: 3, windowMs: hour },
  resetIp: { max: 10, windowMs: 15 * min },
  resetAccount: { max: 8, windowMs: 15 * min },
} as const;
