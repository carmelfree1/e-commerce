import { $, $$, toast } from '../shared/dom';
import { api, send, setUnauthorizedHandler } from '../shared/api';
import { registerServiceWorker } from '../shared/push';
import { hydrateIcons } from './icons';
import { nav, type TabName } from './ui';
import { initDashboard, loadDashboard } from './dashboard';
import { initProducts, loadProducts } from './products';
import { initOrders, loadOrders } from './orders';
import { initAccount, initPush, loadPush } from './settings';

const TABS: TabName[] = ['accueil', 'produits', 'commandes', 'notifs', 'compte'];
const LOADERS: Record<TabName, () => Promise<void>> = {
  accueil: loadDashboard,
  produits: loadProducts,
  commandes: loadOrders,
  notifs: loadPush,
  compte: async () => {},
};

let current: TabName = 'accueil';

function setPill(pending: number): void {
  const pill = $('#pill');
  pill.hidden = pending === 0;
  pill.textContent = String(pending);
}

/** Compteur de commandes en attente : requête minuscule, sans les statistiques complètes. */
async function refreshPill(): Promise<{ pending: number; lastId: number }> {
  const s = await api<{ pending: number; lastId: number }>('/api/admin/pulse');
  setPill(s.pending);
  return s;
}

async function show(tab: TabName): Promise<void> {
  current = tab;
  $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${tab}`; });
  $$('#tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === tab);
    if (b.dataset.tab === tab) b.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
  closeMenu();
  closeNav();
  history.replaceState(null, '', `#${tab}`);
  window.scrollTo({ top: 0 });
  try { await LOADERS[tab](); } catch (e) { toast(e instanceof Error ? e.message : 'Erreur'); }
}
nav.goto = (tab) => { void show(tab); };

/** Recharge la vue courante et le compteur après une modification. */
const refresh = async (): Promise<void> => {
  await Promise.all([refreshPill(), LOADERS[current]()]).catch(() => undefined);
};

/* ----- Menu burger (mobile) ----- */
function setNav(open: boolean): void {
  $('#tabs').classList.toggle('open', open);
  $('#scrim').hidden = !open;
  $('#burger').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('no-scroll', open);
}
const closeNav = (): void => setNav(false);
$('#burger').addEventListener('click', () => setNav(!$('#tabs').classList.contains('open')));
$('#burger-close').addEventListener('click', closeNav);
$('#scrim').addEventListener('click', closeNav);
window.matchMedia('(min-width: 761px)').addEventListener('change', closeNav);

/* ----- Menu utilisateur ----- */
const menu = () => $('#user-menu'), userBtn = () => $('#btn-user');
function closeMenu(): void { menu().hidden = true; userBtn().setAttribute('aria-expanded', 'false'); }
userBtn().addEventListener('click', (e) => {
  e.stopPropagation();
  const open = menu().hidden;
  menu().hidden = !open;
  userBtn().setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.who')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closeNav(); } });

$('#tabs').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (b) void show(b.dataset.tab as TabName);
});
$('#user-menu').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (b) void show(b.dataset.tab as TabName);
});
document.addEventListener('click', (e) => {
  const g = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
  if (g) void show(g.dataset.goto as TabName);
});
$$('[data-dclose]').forEach((b) => b.addEventListener('click', () => b.closest('dialog')?.close()));
$('#logout').addEventListener('click', async () => {
  await send('/api/admin/logout', {});
  location.replace('/admin/login.html');
});

/* ----- Démarrage ----- */
setUnauthorizedHandler(() => location.replace('/admin/login.html'));
hydrateIcons();
initDashboard(refresh);
initProducts(refresh);
initOrders(refresh);
initPush();
initAccount();

let lastId = -1;
async function poll(): Promise<void> {
  if (document.hidden) return;
  const s = await refreshPill();
  if (lastId >= 0 && s.lastId > lastId) {
    toast('Nouvelle commande reçue');
    if (current === 'commandes') void loadOrders();
    if (current === 'accueil') void loadDashboard();
  }
  lastId = s.lastId;
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll().catch(() => undefined); });

api<{ email: string }>('/api/admin/me').then(async (me) => {
  $('#user-mail').textContent = me.email;
  $('#acc-mail').textContent = me.email;
  $('#acc-mail2').textContent = me.email;
  $('#avatar-letter').textContent = me.email.charAt(0);
  const hash = location.hash.slice(1) as TabName;
  await show(TABS.includes(hash) ? hash : 'accueil');
  await poll().catch(() => undefined);
  setInterval(() => { void poll().catch(() => undefined); }, 30_000);
  void registerServiceWorker();
}).catch(() => undefined);
