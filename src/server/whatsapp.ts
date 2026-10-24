import { whatsappLink } from '../shared/contact.js';

export interface WhatsappOrder {
  code: string;
  customerName: string;
  phone: string;
  address: string;
  note: string;
  total: number;
  lines: { name: string; price: number; qty: number }[];
}

/** Taille maximale du texte encodé dans le lien wa.me (les liens très longs sont refusés par certains navigateurs / applications). */
const BUDGET = 1800;

/** Une valeur saisie par le client tient sur une seule ligne : il ne peut pas « fabriquer » de fausses lignes dans le message. */
const oneLine = (s: string) => s.replace(/[\r\n\t\u2028\u2029]+/g, ' ').trim();
/** Séparateur de milliers lisible par WhatsApp (espace normale plutôt que l'espace fine insécable de Intl). */
const fcfa = (n: number) => `${new Intl.NumberFormat('fr-FR').format(n).replace(/[\u202f\u00a0]/g, ' ')} FCFA`;

/** Message de commande prêt à envoyer (mise en forme WhatsApp : *gras*). */
export function buildOrderMessage(o: WhatsappOrder): string {
  const head = [
    `*Nouvelle commande ${o.code}*`,
    '',
    `*Client* : ${oneLine(o.customerName)}`,
    `*Téléphone* : ${oneLine(o.phone)}`,
    `*Adresse de livraison* : ${oneLine(o.address)}`,
    ...(o.note ? [`*Note* : ${oneLine(o.note)}`] : []),
    '',
    '*Articles*',
  ];
  const tail = ['', `*Total* : ${fcfa(o.total)} (paiement à la livraison)`];
  const more = (n: number) => `… et ${n} autre${n > 1 ? 's' : ''} article${n > 1 ? 's' : ''} (voir le code ${o.code})`;

  // Les articles sont ajoutés tant que l'URL encodée reste sous le budget ; le reste est résumé par une ligne « … et N autres ».
  const size = (lines: string[]) => encodeURIComponent(lines.join('\n')).length;
  let room = BUDGET - size(head) - size(tail) - size([more(99)]) - 12;
  const shown: string[] = [];
  for (const l of o.lines) {
    const line = `• ${l.qty} × ${oneLine(l.name)} — ${fcfa(l.price * l.qty)}`;
    const cost = size([line]) + 3; // + retour à la ligne encodé (%0A)
    if (cost > room) break;
    room -= cost; shown.push(line);
  }
  const hidden = o.lines.length - shown.length;
  return [...head, ...shown, ...(hidden > 0 ? [more(hidden)] : []), ...tail].join('\n');
}

export const orderWhatsappUrl = (o: WhatsappOrder): string => whatsappLink(buildOrderMessage(o));
