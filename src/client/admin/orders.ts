import { ORDER_STATUSES, STATUS_LABEL, type AdminOrder, type OrderStatus } from '../../shared/types';
import { $, esc, fmt, num, toast } from '../shared/dom';
import { send, api } from '../shared/api';
import { ic, leafSvg } from './icons';
import { confirmBox, fmtDateTime, guard, relTime } from './ui';

type Filter = OrderStatus | 'all';

let all: AdminOrder[] = [];
let filter: Filter = 'all';
let fresh = new Set<number>();
let afterChange: () => Promise<void> = async () => {};

const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  en_attente: { to: 'confirmee', label: 'Confirmer la commande' },
  confirmee: { to: 'en_livraison', label: 'Passer en livraison' },
  en_livraison: { to: 'livree', label: 'Marquer comme livrée' },
  annulee: { to: 'en_attente', label: 'Réactiver' },
};

export function setOrderFilter(f: Filter): void { filter = f; }

function filters(): void {
  const count = (s: Filter) => (s === 'all' ? all.length : all.filter((o) => o.status === s).length);
  $('#o-filter').innerHTML = (['all', ...ORDER_STATUSES] as Filter[]).map((s) =>
    `<button data-s="${s}" class="${s === filter ? 'on' : ''}">${s === 'all' ? 'Toutes' : STATUS_LABEL[s]}<span class="n">${count(s)}</span></button>`).join('');
}

function render(): void {
  filters();
  const q = $<HTMLInputElement>('#o-search').value.trim().toLowerCase();
  const list = all.filter((o) =>
    (filter === 'all' || o.status === filter)
    && (!q || `${o.code} ${o.customerName} ${o.phone}`.toLowerCase().includes(q)));

  $('#orders').innerHTML = list.map((o) => {
    const n = NEXT[o.status], canCancel = o.status !== 'annulee' && o.status !== 'livree';
    const qty = o.items.reduce((sum, i) => sum + i.qty, 0);
    const lines = o.items.map((i) => `<li class="bl">
        ${i.image ? `<img class="bl-img" src="${esc(i.image)}" alt="" loading="lazy" decoding="async">` : `<span class="bl-img ph">${leafSvg}</span>`}
        <div class="bl-t"><b>${esc(i.name)}</b><span>${num(i.price)} FCFA × ${i.qty}</span></div>
        <b class="bl-p">${fmt(i.price * i.qty)}</b></li>`).join('');
    return `<article class="order s-${o.status} ${fresh.has(o.id) ? 'new' : ''}">
      <header class="o-head">
        <div><span class="code">${esc(o.code)}</span><span class="badge s-${o.status}">${STATUS_LABEL[o.status]}</span>
          <div class="when">${fmtDateTime(o.createdAt)} · ${relTime(o.createdAt)}</div></div>
        <div class="total">${fmt(o.total)}<small>à payer à la livraison</small></div>
      </header>
      <div class="o-body">
        <section class="o-box o-client" aria-label="Client">
          <h3>${ic('user')}Client</h3>
          <dl>
            <dt>Nom</dt><dd>${esc(o.customerName)}</dd>
            <dt>Téléphone</dt><dd><a href="tel:${esc(o.phone)}">${esc(o.phone)}</a></dd>
            <dt>Adresse</dt><dd>${esc(o.address)}</dd>
            ${o.note ? `<dt>Note</dt><dd class="o-note">« ${esc(o.note)} »</dd>` : ''}
          </dl>
        </section>
        <section class="o-box o-basket" aria-label="Panier">
          <h3>${ic('bag')}Panier <span class="o-count">${qty} article${qty > 1 ? 's' : ''}</span></h3>
          <ul class="basket">${lines}</ul>
          <div class="basket-total"><span>Total</span><b>${fmt(o.total)}</b></div>
        </section>
      </div>
      <footer class="acts">
        <a class="btn ghost sm" href="tel:${esc(o.phone)}">${ic('phone')}Appeler</a>
        ${canCancel ? `<button class="btn ghost sm" data-id="${o.id}" data-to="annulee">Annuler</button>` : ''}
        ${n ? `<button class="btn sm" data-id="${o.id}" data-to="${n.to}">${ic(n.to === 'en_livraison' ? 'truck' : 'check')}${n.label}</button>` : ''}
      </footer></article>`;
  }).join('') || `<div class="empty"><b>${all.length ? 'Aucune commande ne correspond' : 'Aucune commande pour le moment'}</b>${all.length ? 'Modifiez la recherche ou le filtre.' : 'Elles apparaîtront ici dès que vos clients commanderont.'}</div>`;
}

export async function loadOrders(): Promise<void> {
  const next = await api<AdminOrder[]>('/api/admin/orders');
  if (all.length) fresh = new Set(next.filter((o) => !all.some((a) => a.id === o.id)).map((o) => o.id));
  all = next;
  render();
}

export function initOrders(onChange: () => Promise<void>): void {
  afterChange = onChange;
  $('#o-search').addEventListener('input', render);
  $('#o-filter').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-s]');
    if (b) { filter = b.dataset.s as Filter; render(); }
  });
  $('#o-refresh').addEventListener('click', guard(async () => { await loadOrders(); toast('Commandes actualisées'); }));
  $('#orders').addEventListener('click', guard(async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-to]');
    if (!b) return;
    const to = b.dataset.to as OrderStatus, o = all.find((x) => x.id === Number(b.dataset.id));
    if (!o) return;
    if (to === 'annulee' && !(await confirmBox(`Annuler ${o.code} ?`, 'Les articles seront remis en stock et le client sera prévenu.', 'Annuler la commande'))) return;
    await send(`/api/admin/orders/${o.id}/status`, { status: to }, 'PATCH');
    toast(`Commande ${STATUS_LABEL[to].toLowerCase()}`);
    fresh.clear();
    await loadOrders();
    void afterChange();
  }));
}
