import type { PushSubscriptionJSON } from '../../shared/types';
import { api } from './api';

export const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const toKey = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

/** Renvoie l'abonnement push de l'appareil ; `ask` autorise l'affichage de la demande de permission. */
export async function getSubscription(ask: boolean): Promise<PushSubscriptionJSON | null> {
  if (!pushSupported || Notification.permission === 'denied') return null;
  if (Notification.permission !== 'granted') {
    if (!ask || (await Notification.requestPermission()) !== 'granted') return null;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api<{ key: string }>('/api/vapid-key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) });
  }
  return sub.toJSON() as PushSubscriptionJSON;
}

export const registerServiceWorker = () =>
  'serviceWorker' in navigator ? navigator.serviceWorker.register('/sw.js').catch(() => undefined) : Promise.resolve(undefined);
