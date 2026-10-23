import { $, errMsg, toast } from '../shared/dom';

export type TabName = 'accueil' | 'produits' | 'commandes' | 'notifs' | 'compte';

/** Pont de navigation : branché par main.ts pour éviter les imports circulaires. */
export const nav = {
  goto: (_tab: TabName): void => {},
};

export function confirmBox(title: string, text: string, okLabel = 'Confirmer'): Promise<boolean> {
  const dlg = $<HTMLDialogElement>('#dlg-confirm');
  $('#cf-title').textContent = title;
  $('#cf-text').textContent = text;
  $('#cf-ok').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    dlg.returnValue = 'no';
    dlg.showModal();
  });
}

const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = (iso: string): string => DATE.format(new Date(iso));

export function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `il y a ${Math.floor(s / 86400)} j`;
  return fmtDateTime(iso);
}

/** Enveloppe un gestionnaire async : toute erreur devient un toast. */
export function guard<A extends unknown[]>(fn: (...a: A) => Promise<void>) {
  return async (...a: A): Promise<void> => {
    try { await fn(...a); } catch (e) { toast(errMsg(e)); }
  };
}
