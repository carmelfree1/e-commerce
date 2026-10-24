import type { PublicProduct } from '../../shared/types';
import { $, $$, toast } from '../shared/dom';
import { api, send } from '../shared/api';
import { getSubscription, pushSupported, registerServiceWorker } from '../shared/push';
import { store } from './state';
import { initCatalog, renderCatalog, setCategory } from './catalog';
import { initCart, openPanel, reconcileCart, renderCart } from './cart';
import { initTrack, openTrack } from './track';

/** Catalogue embarqué dans le HTML par le serveur : affichage immédiat, sans requête réseau. */
function readBoot(): PublicProduct[] | null {
  const el = document.getElementById('boot');
  if (!el?.textContent) return null;
  try { return JSON.parse(el.textContent) as PublicProduct[]; } catch { return null; }
}

let lastLoad = Date.now();

async function load(): Promise<void> {
  lastLoad = Date.now();
  try {
    store.products = await api<PublicProduct[]>('/api/products');
  } catch {
    toast('Connexion indisponible');
  }
  reconcileCart();
  renderCatalog();
  renderCart();
}

/* ----- Navigation, recherche, annonce ----- */
document.addEventListener('click', (e) => {
  const c = (e.target as HTMLElement).closest<HTMLElement>('[data-cat]');
  if (c) { setCategory(c.dataset.cat || 'Tous'); openPanel(null); $('#catalogue').scrollIntoView(); }
});
$('#see-all').addEventListener('click', () => setCategory('Tous'));
$('#search').addEventListener('input', () => { store.cat = 'Tous'; renderCatalog(); });
$('#btn-search').addEventListener('click', () => {
  const bar = $('#searchbar');
  bar.hidden = !bar.hidden;
  $('#btn-search').setAttribute('aria-expanded', String(!bar.hidden));
  if (!bar.hidden) $('#search').focus();
});
$('#searchbar').addEventListener('submit', (e) => { e.preventDefault(); $('#catalogue').scrollIntoView(); });
$('#notice-x').addEventListener('click', () => $('#notice').remove());
$$('[data-dclose]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));

/* ----- Modules ----- */
initCatalog();
initTrack();
initCart((res) => {
  if (res) {
    try { localStorage.setItem('ccm-last', res.code); localStorage.setItem('ccm-last-wa', JSON.stringify({ code: res.code, url: res.whatsappUrl })); } catch { /* ignoré */ }
    $('#done-code').textContent = res.code;
    $<HTMLAnchorElement>('#done-wa').href = res.whatsappUrl;
    $<HTMLDialogElement>('#dlg-done').showModal();
  }
  void load();
});

/* ----- Notifications push ----- */
if (pushSupported) {
  const nb = $<HTMLButtonElement>('#btn-notif');
  nb.hidden = Notification.permission !== 'default';
  nb.addEventListener('click', async () => {
    try {
      const sub = await getSubscription(true);
      if (sub) { await send('/api/subscribe', { subscription: sub }); nb.hidden = true; toast('Notifications activées'); }
    } catch {
      toast("Impossible d'activer les notifications");
    }
  });
}

/* ----- PWA ----- */
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<unknown> }
let installEvt: InstallEvent | null = null;
void registerServiceWorker();
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e as InstallEvent; $('#btn-install').hidden = false; });
$('#btn-install').addEventListener('click', async () => {
  if (!installEvt) return;
  await installEvt.prompt();
  await installEvt.userChoice;
  installEvt = null;
  $('#btn-install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; });

const boot = readBoot();
if (boot) {
  store.products = boot;
  reconcileCart();
  renderCatalog();
  renderCart();
} else {
  void load();
}
// Stocks toujours à jour : on rafraîchit (réponse 304 quasi instantanée si rien n'a changé) au retour sur l'onglet.
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 5000) void load(); });
const suivi = new URLSearchParams(location.search).get('suivi');
if (suivi) openTrack(suivi);
