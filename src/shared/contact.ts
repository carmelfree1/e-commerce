/** Numéro WhatsApp de la boutique (Côte d'Ivoire, indicatif +225). */
export const WHATSAPP_DISPLAY = '01 41 52 51 04';
export const WHATSAPP_INTL = '2250141525104';

/** Lien WhatsApp avec un message pré-rempli. */
export const whatsappLink = (message: string): string =>
  `https://wa.me/${WHATSAPP_INTL}?text=${encodeURIComponent(message)}`;
