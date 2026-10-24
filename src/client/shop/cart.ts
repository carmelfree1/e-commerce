import type { CheckoutPayload, OrderResult } from '../../shared/types';
import { $, $$, esc, errMsg, fmt, pulse, toast } from '../shared/dom';
import { send } from '../shared/api';
import { getSubscription } from '../shared/push';
import { findProduct, saveCart, store } from './state';

export function renderCart(): void {
  const ids = Object.keys(store.cart).map(Number);
  $('#cart-count').textContent = String(ids.reduce((s, id) => s + store.cart[id], 0));
  let total = 0;
  $('#cart-lines').innerHTML = ids.length
    ? ids.map((id) => {
        const p = findProduct(id);
        if (!p) return '';
        total += p.price * store.cart[id];
        return `<div class="line"><div><div class="nm">${esc(p.name)}</div><div class="sub">${fmt(p.price)} × ${store.cart[id]}</div></div>
          <div class="qty"><button data-d="-1" data-id="${p.id}" aria-label="Moins">−</button><span>${store.cart[id]}</span><button data-d="1" data-id="${p.id}" aria-label="Plus">+</button></div></div>`;
      }).join('')
    : '<p class="muted center">Votre panier est vide.</p>';
  $('#cart-total').textContent = fmt(total);
  $<HTMLButtonElement>('#checkout button[type=submit]').disabled = !ids.length;
}

export function addToCart(id: number, delta: number): void {
  const p = findProduct(id);
  if (!p) return;
  const n = (store.cart[id] || 0) + delta;
  if (n <= 0) delete store.cart[id];
  else if (n > p.stock) { toast(`Stock disponible : ${p.stock}`); return; }
  else store.cart[id] = n;
  saveCart();
  renderCart();
  if (delta > 0) { toast('Ajouté au panier'); pulse($('#btn-cart'), 'bump'); }
}

/** Retire du panier les produits disparus ou dont le stock a baissé. */
export function reconcileCart(): void {
  for (const key of Object.keys(store.cart)) {
    const id = Number(key), p = findProduct(id);
    if (!p || p.stock === 0) delete store.cart[id];
    else store.cart[id] = Math.min(store.cart[id], p.stock);
  }
  saveCart();
}

export type PanelName = 'cart' | 'menu' | null;
export function openPanel(which: PanelName): void {
  for (const [sel, name] of [['#drawer', 'cart'], ['#menu', 'menu']] as const) {
    const open = which === name;
    $(sel).classList.toggle('open', open);
    $(sel).setAttribute('aria-hidden', String(!open));
  }
  $('#overlay').hidden = !which;
}

export function initCart(onOrdered: (res: OrderResult | null) => void): void {
  $('#cart-lines').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-d]');
    if (b) addToCart(Number(b.dataset.id), Number(b.dataset.d));
  });
  $('#btn-cart').addEventListener('click', () => openPanel('cart'));
  $('#btn-menu').addEventListener('click', () => openPanel('menu'));
  $('#overlay').addEventListener('click', () => openPanel(null));
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => openPanel(null)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openPanel(null); });

  const form = $<HTMLFormElement>('#checkout');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('button[type=submit]', form), err = $('#form-error');
    err.hidden = true; btn.disabled = true;
    try {
      let subscription: CheckoutPayload['subscription'] = null;
      if ($<HTMLInputElement>('#opt-push').checked) {
        try { subscription = await getSubscription(true); } catch { /* push facultatif */ }
      }
      const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
      const payload: CheckoutPayload = {
        name: field('name'), phone: field('phone'), address: field('address'), note: field('note'), subscription,
        items: Object.entries(store.cart).map(([id, qty]) => ({ id: Number(id), qty })),
      };
      const res = await send<OrderResult>('/api/orders', payload);
      store.cart = {}; saveCart(); form.reset(); openPanel(null);
      onOrdered(res);
    } catch (x) {
      err.textContent = errMsg(x); err.hidden = false;
      onOrdered(null);
    } finally {
      btn.disabled = !Object.keys(store.cart).length;
    }
  });
}
