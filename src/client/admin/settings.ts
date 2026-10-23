import { $, toast } from '../shared/dom';
import { api, send } from '../shared/api';
import { getSubscription, pushSupported } from '../shared/push';
import { guard } from './ui';

/* ----- Notifications ----- */
export async function loadPush(): Promise<void> {
  const s = await api<{ clients: number; admins: number }>('/api/admin/push/stats');
  $('#client-count').textContent = s.clients
    ? `${s.clients} client${s.clients > 1 ? 's' : ''} abonné${s.clients > 1 ? 's' : ''} aux notifications.`
    : 'Aucun client abonné pour le moment : ils peuvent activer les notifications depuis la boutique.';
  $('#admin-count').textContent = `${s.admins} appareil${s.admins > 1 ? 's' : ''} administrateur enregistré${s.admins > 1 ? 's' : ''}.`;
  $('#push-state').textContent = !pushSupported
    ? 'Non supporté par ce navigateur.'
    : Notification.permission === 'granted' ? 'Autorisé sur cet appareil' : Notification.permission === 'denied' ? 'Bloqué dans le navigateur' : '';
}

export function initPush(): void {
  $('#admin-push').addEventListener('click', guard(async () => {
    if (!pushSupported) throw new Error('Notifications non supportées ici');
    const sub = await getSubscription(true);
    if (!sub) throw new Error('Autorisation refusée');
    await send('/api/admin/push/subscribe', { subscription: sub });
    toast('Alertes activées');
    await loadPush();
  }));

  const form = $<HTMLFormElement>('#bcast');
  const preview = () => {
    $('#pv-title').textContent = (form.elements.namedItem('title') as HTMLInputElement).value || "Titre de l'annonce";
    $('#pv-body').textContent = (form.elements.namedItem('body') as HTMLTextAreaElement).value || 'Aperçu de la notification…';
  };
  form.addEventListener('input', preview);
  form.addEventListener('submit', guard(async (e: Event) => {
    e.preventDefault();
    const r = await send<{ sent: number }>('/api/admin/push/broadcast', {
      title: (form.elements.namedItem('title') as HTMLInputElement).value,
      body: (form.elements.namedItem('body') as HTMLTextAreaElement).value,
    });
    form.reset(); preview();
    toast(`Annonce envoyée à ${r.sent} client${r.sent > 1 ? 's' : ''}`);
  }));
}

/* ----- Compte ----- */
export function initAccount(): void {
  const form = $<HTMLFormElement>('#pw');
  form.addEventListener('submit', guard(async (e: Event) => {
    e.preventDefault();
    await send('/api/admin/password', {
      current: (form.elements.namedItem('current') as HTMLInputElement).value,
      next: (form.elements.namedItem('next') as HTMLInputElement).value,
    });
    form.reset();
    toast('Mot de passe modifié');
  }));
}
