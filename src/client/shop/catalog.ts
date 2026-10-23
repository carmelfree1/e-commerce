import { KIND_LABEL, LOW_STOCK, type PublicProduct } from '../../shared/types';
import { $, esc, fmt, num } from '../shared/dom';
import { whatsappLink } from '../../shared/contact';
import { store, findProduct } from './state';
import { addToCart } from './cart';

const TINTS: [string, string][] = [['#dcebd9', '#1b7f3b'], ['#f6e1da', '#c62020'], ['#e9efd6', '#0f5a2c'], ['#f1e6c9', '#1b7f3b']];

function placeholder(key: string): string {
  const sum = [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
  const [bg, fg] = TINTS[sum % TINTS.length];
  return `<div class="ph" style="background:${bg}"><svg viewBox="0 0 64 64" aria-hidden="true"><g transform="rotate(-40 32 32)"><ellipse cx="32" cy="32" rx="22" ry="10" fill="${fg}"/><path d="M8 32h48" stroke="${bg}" stroke-width="1.6"/></g></svg></div>`;
}

export const picture = (p: PublicProduct): string =>
  p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : placeholder(p.category);

export function setCategory(c: string): void {
  store.cat = c;
  $<HTMLInputElement>('#search').value = '';
  renderCatalog();
}

export function renderCatalog(): void {
  const q = $<HTMLInputElement>('#search').value.trim().toLowerCase();
  const cats = ['Tous', ...new Set(store.products.map((p) => p.category))];
  $('#cats').innerHTML = cats.map((c) =>
    `<button class="chip ${c === store.cat ? 'on' : ''}" role="tab" aria-selected="${c === store.cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('#menu-cats').innerHTML = cats.map((c) =>
    `<button class="menu-item ${c === store.cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');

  const list = store.products.filter((p) =>
    (store.cat === 'Tous' || p.category === store.cat) && (!q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q)));
  $('#empty').hidden = list.length > 0;
  $('#grid').innerHTML = list.map((p) => {
    const out = p.stock === 0, low = !out && p.stock <= LOW_STOCK;
    return `<article class="card ${out ? 'is-out' : ''}">
      <div class="pic" data-open="${p.id}" role="button" tabindex="0" aria-label="Voir ${esc(p.name)}">${picture(p)}
        ${out ? '<span class="badge out">Rupture</span>' : low ? '<span class="badge">Dernières pièces</span>' : ''}</div>
      ${p.kind === 'medicament' ? `<span class="kind-tag">${KIND_LABEL.medicament}</span>` : ''}
      <h3>${esc(p.name)}</h3>
      <div class="price">${num(p.price)}<small>FCFA</small></div>
      <p class="stock ${low ? 'low' : ''}">${out ? 'Indisponible' : low ? `Plus que ${p.stock} en stock` : 'En stock'}</p>
      <button class="btn" data-add="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Rupture de stock' : 'Ajouter au panier'}</button></article>`;
  }).join('');
}

/* ----- Fiche produit ----- */
let current: PublicProduct | undefined;
let qty = 1;

export function openProduct(id: number): void {
  current = findProduct(id);
  if (!current) return;
  qty = 1;
  const p = current, out = p.stock === 0;
  $('#pd-pic').innerHTML = picture(p);
  $('#pd-cat').textContent = p.category;
  $('#pd-name').textContent = p.name;
  $('#pd-price').textContent = fmt(p.price);
  $('#pd-desc').textContent = p.description;
  $<HTMLAnchorElement>('#pd-wa').href = whatsappLink(`Bonjour CCM-NONSAKA, j'ai une question sur : ${p.name}`);
  $('#pd-usage').hidden = p.kind !== 'medicament';
  $('#pd-usage-text').textContent = p.usage;
  $('#pd-stock').textContent = out ? 'Rupture de stock' : p.stock <= LOW_STOCK ? `Plus que ${p.stock} en stock` : 'En stock';
  $('#pd-stock').classList.toggle('low', out || p.stock <= LOW_STOCK);
  $<HTMLButtonElement>('#pd-add').disabled = out;
  $('#pd-qty').hidden = out;
  $('#pd-n').textContent = '1';
  $<HTMLDialogElement>('#dlg-prod').showModal();
}

export function initCatalog(): void {
  $('#grid').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const add = t.closest<HTMLElement>('[data-add]'), open = t.closest<HTMLElement>('[data-open]');
    if (add) addToCart(Number(add.dataset.add), 1);
    else if (open) openProduct(Number(open.dataset.open));
  });
  $('#grid').addEventListener('keydown', (e) => {
    const open = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
    if (open && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openProduct(Number(open.dataset.open)); }
  });
  $('#pd-qty').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-q]');
    if (!b || !current) return;
    qty = Math.min(current.stock, Math.max(1, qty + Number(b.dataset.q)));
    $('#pd-n').textContent = String(qty);
  });
  $('#pd-add').addEventListener('click', () => {
    if (!current) return;
    addToCart(current.id, qty);
    $<HTMLDialogElement>('#dlg-prod').close();
  });
}
