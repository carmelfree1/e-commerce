import { KIND_LABEL, LOW_STOCK, MIN_USAGE_LENGTH, type AdminProduct, type ProductInput, type ProductKind } from '../../shared/types';
import { $, $$, esc, errMsg, fmt, toast } from '../shared/dom';
import { api, send } from '../shared/api';
import { ic, leafSvg } from './icons';
import { confirmBox, guard } from './ui';

type StockFilter = 'all' | 'low' | 'out' | 'hidden';

let all: AdminProduct[] = [];
let filter: StockFilter = 'all';
let afterChange: () => Promise<void> = async () => {};

export function setStockFilter(f: StockFilter): void {
  filter = f;
  $$('#p-filter button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
}

const isLow = (p: AdminProduct) => p.stock > 0 && p.stock <= LOW_STOCK;

function thumb(p: AdminProduct): string {
  return p.image
    ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">`
    : `<span class="thumb">${leafSvg}</span>`;
}

function render(): void {
  const q = $<HTMLInputElement>('#p-search').value.trim().toLowerCase();
  const cat = $<HTMLSelectElement>('#p-cat').value;
  const list = all.filter((p) => {
    if (q && !`${p.name} ${p.category}`.toLowerCase().includes(q)) return false;
    if (cat && p.category !== cat) return false;
    if (filter === 'low') return isLow(p);
    if (filter === 'out') return p.stock === 0;
    if (filter === 'hidden') return !p.active;
    return true;
  });
  const lows = all.filter((p) => isLow(p) || p.stock === 0).length;
  $('#prod-sub').textContent = `${all.length} produit${all.length > 1 ? 's' : ''}${lows ? ` · ${lows} à réapprovisionner` : ''}`;

  $('#p-rows').innerHTML = list.map((p) => `<tr class="${p.active ? '' : 'off'}">
    <td><div class="pcell">${thumb(p)}<div><div class="pname">${esc(p.name)}</div><div class="pcat">${esc(p.category)}${p.kind === 'medicament' ? ' <span class="tag med">Médicament traditionnel</span>' : ''}</div></div></div></td>
    <td>${fmt(p.price)}</td>
    <td><div class="stock"><span class="stepper"><button data-st="-1" data-id="${p.id}" aria-label="Retirer 1">−</button><b class="${p.stock === 0 ? 'out' : isLow(p) ? 'low' : ''}">${p.stock}</b><button data-st="1" data-id="${p.id}" aria-label="Ajouter 1">+</button><button data-st="10" data-id="${p.id}" aria-label="Ajouter 10" title="Ajouter 10">+10</button></span>
      ${p.stock === 0 ? '<span class="tag out">Rupture</span>' : isLow(p) ? '<span class="tag low">Stock bas</span>' : ''}</div></td>
    <td><label class="switch" title="${p.active ? 'Visible' : 'Masqué'}"><input type="checkbox" data-vis="${p.id}" ${p.active ? 'checked' : ''} aria-label="Visible en boutique"><i></i></label></td>
    <td><div class="actions"><button class="icon-btn" data-edit="${p.id}" aria-label="Modifier ${esc(p.name)}" title="Modifier">${ic('edit')}</button>
      <button class="icon-btn del" data-del="${p.id}" aria-label="Supprimer ${esc(p.name)}" title="Supprimer">${ic('trash')}</button></div></td></tr>`).join('');

  const empty = $('#p-empty');
  empty.hidden = list.length > 0;
  $('#p-table').parentElement!.hidden = list.length === 0;
  empty.innerHTML = all.length
    ? '<b>Aucun produit ne correspond</b>Modifiez la recherche ou les filtres.'
    : '<b>Votre catalogue est vide</b>Ajoutez votre premier produit bio pour ouvrir la boutique.';
}

export async function loadProducts(): Promise<void> {
  all = await api<AdminProduct[]>('/api/admin/products');
  const cats = [...new Set(all.map((p) => p.category))].sort();
  const sel = $<HTMLSelectElement>('#p-cat'), keep = sel.value;
  sel.innerHTML = '<option value="">Toutes les catégories</option>' + cats.map((c) => `<option ${c === keep ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('#cat-list').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
  render();
}

/* ----- Fenêtre ajout / modification ----- */
const form = () => $<HTMLFormElement>('#prod-form');
let editing: AdminProduct | null = null;
let image = '';

function setImage(url: string): void {
  image = url;
  const prev = $<HTMLImageElement>('#prev');
  prev.hidden = !url;
  if (url) prev.src = url; else prev.removeAttribute('src');
  $('#drop').classList.toggle('has', !!url);
  $('#rm-img').hidden = !url;
}

const kindInputs = () => Array.from(form().querySelectorAll<HTMLInputElement>('input[name=kind]'));
const currentKind = (): ProductKind => (kindInputs().find((r) => r.checked)?.value as ProductKind | undefined) ?? 'produit';

function setKind(kind: ProductKind): void {
  kindInputs().forEach((r) => { r.checked = r.value === kind; });
  const med = kind === 'medicament';
  $('#usage-row').hidden = !med;
  (form().elements.namedItem('usage') as HTMLTextAreaElement).required = med;
  (form().elements.namedItem('usage') as HTMLTextAreaElement).minLength = med ? MIN_USAGE_LENGTH : 0;
  const cat = form().elements.namedItem('category') as HTMLInputElement;
  cat.placeholder = med ? 'Médicaments traditionnels' : 'Fruits, Huiles…';
}

export function openProductDialog(p: AdminProduct | null = null): void {
  editing = p;
  const f = form();
  f.reset();
  $('#prod-title').textContent = p ? 'Modifier le produit' : 'Nouveau produit';
  if (p) {
    (f.elements.namedItem('name') as HTMLInputElement).value = p.name;
    (f.elements.namedItem('price') as HTMLInputElement).value = String(p.price);
    (f.elements.namedItem('stock') as HTMLInputElement).value = String(p.stock);
    (f.elements.namedItem('category') as HTMLInputElement).value = p.category;
    (f.elements.namedItem('description') as HTMLTextAreaElement).value = p.description;
    (f.elements.namedItem('active') as HTMLInputElement).checked = p.active;
    (f.elements.namedItem('usage') as HTMLTextAreaElement).value = p.usage;
  }
  setKind(p?.kind ?? 'produit');
  setImage(p?.image || '');
  $('#prod-err').hidden = true;
  $<HTMLDialogElement>('#dlg-prod').showModal();
  (f.elements.namedItem('name') as HTMLInputElement).focus();
}

const MAX_SIDE = 1200;

/** Réduit la photo (1200 px max, WebP) : un fichier 10 fois plus léger = une boutique qui s'affiche beaucoup plus vite. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.82));
    return blob && blob.type === 'image/webp' && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function upload(file: File): Promise<void> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Format accepté : JPG, PNG ou WebP'); return; }
  const body = await shrink(file);
  if (body.size > 3 * 1024 * 1024) { toast('Image trop lourde (3 Mo max)'); return; }
  const r = await api<{ url: string }>('/api/admin/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
  setImage(r.url);
}

export function initProducts(onChange: () => Promise<void>): void {
  afterChange = onChange;
  $('#p-search').addEventListener('input', render);
  $('#p-cat').addEventListener('change', render);
  $('#p-filter').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-f]');
    if (b) { setStockFilter(b.dataset.f as StockFilter); render(); }
  });

  $('#p-rows').addEventListener('click', guard(async (e: Event) => {
    const t = e.target as HTMLElement;
    const st = t.closest<HTMLElement>('[data-st]'), ed = t.closest<HTMLElement>('[data-edit]'), dl = t.closest<HTMLElement>('[data-del]');
    if (st) {
      await send(`/api/admin/products/${st.dataset.id}/stock`, { delta: Number(st.dataset.st) }, 'PATCH');
      await loadProducts(); void afterChange();
    } else if (ed) {
      openProductDialog(all.find((p) => p.id === Number(ed.dataset.edit)) ?? null);
    } else if (dl) {
      const p = all.find((x) => x.id === Number(dl.dataset.del));
      if (p && await confirmBox('Supprimer ce produit ?', `« ${p.name} » sera supprimé définitivement. Pour le retirer sans le perdre, masquez-le plutôt.`, 'Supprimer')) {
        await api(`/api/admin/products/${p.id}`, { method: 'DELETE' });
        toast('Produit supprimé');
        await loadProducts(); void afterChange();
      }
    }
  }));
  $('#p-rows').addEventListener('change', guard(async (e: Event) => {
    const c = (e.target as HTMLElement).closest<HTMLInputElement>('[data-vis]');
    if (!c) return;
    try {
      await send(`/api/admin/products/${c.dataset.vis}/active`, { active: c.checked }, 'PATCH');
      toast(c.checked ? 'Produit visible en boutique' : 'Produit masqué');
    } finally { await loadProducts(); }
  }));
  $$('[data-new-product]').forEach((b) => b.addEventListener('click', () => openProductDialog(null)));

  /* Photo : clic, clavier, glisser-déposer */
  const drop = $('#drop'), file = $<HTMLInputElement>('#file');
  const pick = (f?: File) => { if (f) void upload(f).catch((x) => toast(errMsg(x))); };
  drop.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('#rm-img')) file.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => { pick(file.files?.[0]); file.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer?.files[0]); });
  $('#rm-img').addEventListener('click', () => setImage(''));
  kindInputs().forEach((r) => r.addEventListener('change', () => setKind(currentKind())));

  form().addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form(), val = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
    const body: ProductInput = {
      name: val('name'), price: val('price'), stock: val('stock'), category: val('category'), description: val('description'),
      kind: currentKind(), usage: val('usage'), image, active: (f.elements.namedItem('active') as HTMLInputElement).checked,
    };
    try {
      if (editing) await send(`/api/admin/products/${editing.id}`, body, 'PUT');
      else await send('/api/admin/products', body);
      $<HTMLDialogElement>('#dlg-prod').close();
      toast('Produit enregistré');
      await loadProducts(); void afterChange();
    } catch (x) {
      $('#prod-err').textContent = errMsg(x);
      $('#prod-err').hidden = false;
    }
  });
}
