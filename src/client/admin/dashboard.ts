import { LOW_STOCK, ORDER_STATUSES, STATUS_LABEL, type AdminOrder, type DayStat, type Stats } from '../../shared/types';
import { $, $$, esc, fmt, num, toast } from '../shared/dom';
import { api, send } from '../shared/api';
import { ic } from './icons';
import { guard, nav, relTime } from './ui';
import { setOrderFilter } from './orders';
import { setStockFilter } from './products';

let stats: Stats | null = null;
let metric: 'revenue' | 'orders' = 'revenue';

const compact = (n: number): string => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)} k` : String(n));

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v)), f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const parseDay = (d: string) => new Date(`${d}T12:00:00`);

function kpis(s: Stats): string {
  const lowCount = s.lowStock.length;
  const card = (cls: string, icon: Parameters<typeof ic>[0], value: string, label: string, note: string, warn = false, action = '') =>
    `<${action ? `button type="button" data-act="${action}"` : 'div'} class="kpi ${cls}"><span class="ic">${ic(icon)}</span>
      <div><b>${value}</b><span>${label}</span><small class="${warn ? 'warn' : ''}">${note}</small></div></${action ? 'button' : 'div'}>`;
  return [
    card('g', 'coins', fmt(s.revenue), "Chiffre d'affaires", `+ ${fmt(s.todayRevenue)} aujourd'hui`),
    card('b', 'trend', String(s.todayOrders), "Commandes aujourd'hui", `${s.orders} au total`),
    card('r', 'clock', String(s.pending), 'À traiter', s.pending ? 'Commandes en attente' : 'Rien en attente', s.pending > 0, 'pending'),
    card('a', 'box', String(s.products), 'Produits', lowCount ? `${lowCount} en stock bas` : 'Stocks suffisants', lowCount > 0, 'low'),
  ].join('');
}

function renderChart(): void {
  if (!stats) return;
  const days = stats.daily;
  const W = 700, H = 230, L = 46, B = 30, T = 10, plotH = H - B - T, plotW = W - L - 6;
  const val = (d: DayStat) => (metric === 'revenue' ? d.revenue : d.orders);
  const max = niceCeil(Math.max(...days.map(val), 1));
  const slot = plotW / days.length, bw = slot * 0.58;
  const today = days[days.length - 1]?.day;
  const total = days.reduce((a, d) => a + val(d), 0), orders = days.reduce((a, d) => a + d.orders, 0);
  const label = (d: DayStat) => `<b>${DAY.format(parseDay(d.day))}</b> · ${d.orders} commande${d.orders > 1 ? 's' : ''} · ${fmt(d.revenue)}`;
  const info = $('#chart-info');
  const idle = `Sur 14 jours : <b>${metric === 'revenue' ? fmt(total) : `${orders} commandes`}</b>`;
  info.innerHTML = idle;

  const grid = [0, 1, 2, 3, 4].map((i) => {
    const y = T + plotH - (plotH * i) / 4;
    const v = (max * i) / 4;
    return `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}"/><text class="lbl" x="${L - 8}" y="${y + 4}" text-anchor="end">${metric === 'revenue' ? compact(v) : +v.toFixed(1)}</text>`;
  }).join('');
  const bars = days.map((d, i) => {
    const h = (val(d) / max) * plotH, x = L + i * slot + (slot - bw) / 2, y = T + plotH - h;
    const dt = parseDay(d.day);
    const showMonth = i === 0 || dt.getDate() === 1;
    return `<g class="col ${d.day === today ? 'today' : ''}" tabindex="0" role="img" data-i="${i}" aria-label="${DAY.format(dt)} : ${d.orders} commandes, ${fmt(d.revenue)}">
      <rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${plotH + B}"/>
      <rect class="cbar cbar-anim" x="${x}" y="${val(d) ? y : T + plotH - 2}" width="${bw}" height="${val(d) ? Math.max(h, 2) : 2}" rx="4" style="animation-delay:${i * 25}ms"/>
      <text class="lbl" x="${x + bw / 2}" y="${H - 10}" text-anchor="middle">${dt.getDate()}${showMonth ? ' ' + dt.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') : ''}</text></g>`;
  }).join('');
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Ventes des 14 derniers jours"><g class="grid">${grid}</g>${bars}</svg>`;

  const show = (el: Element | null) => {
    const i = Number((el as HTMLElement | null)?.dataset.i);
    if (Number.isFinite(i) && days[i]) info.innerHTML = label(days[i]);
  };
  $$('#chart g.col').forEach((g) => {
    g.addEventListener('mouseenter', () => show(g));
    g.addEventListener('focus', () => show(g));
    g.addEventListener('click', () => show(g));
    g.addEventListener('mouseleave', () => { info.innerHTML = idle; });
    g.addEventListener('blur', () => { info.innerHTML = idle; });
  });
}

function renderStatus(s: Stats): void {
  const total = s.orders || 1;
  $('#status-bar').innerHTML = ORDER_STATUSES.filter((k) => s.byStatus[k])
    .map((k) => `<i class="s-${k}" style="width:${(s.byStatus[k] / total) * 100}%" title="${STATUS_LABEL[k]}"></i>`).join('');
  $('#status-list').innerHTML = ORDER_STATUSES
    .map((k) => `<li class="s-${k}"><span class="dot"></span>${STATUS_LABEL[k]}<b>${s.byStatus[k]}</b></li>`).join('');
}

function renderLists(s: Stats, recent: AdminOrder[]): void {
  $('#low').innerHTML = s.lowStock.length
    ? `<ul class="rows">${s.lowStock.slice(0, 6).map((p) => `<li><div class="grow"><div class="t">${esc(p.name)}</div>
        <div class="s">${p.stock === 0 ? '<span class="tag out">Rupture</span>' : `<span class="tag low">${p.stock} restant${p.stock > 1 ? 's' : ''}</span>`}</div></div>
        <button class="btn soft sm" data-restock="${p.id}">+10 en stock</button></li>`).join('')}</ul>`
    : `<div class="empty"><b>Tout est en ordre</b>Aucun produit sous ${LOW_STOCK + 1} unités.</div>`;

  const best = s.top[0]?.qty || 1;
  $('#top').innerHTML = s.top.length
    ? `<ul class="rows">${s.top.map((t, i) => `<li><span class="rank">${i + 1}</span><div class="grow"><div class="t">${esc(t.name)}</div>
        <div class="meter"><i style="width:${(t.qty / best) * 100}%"></i></div></div><b>${num(t.qty)}</b></li>`).join('')}</ul>`
    : '<div class="empty"><b>Pas encore de ventes</b>Les produits les plus commandés apparaîtront ici.</div>';

  $('#recent').innerHTML = recent.length
    ? `<ul class="rows">${recent.map((o) => `<li><div class="grow"><div class="t">${esc(o.code)} · ${esc(o.customerName)}</div><div class="s">${relTime(o.createdAt)}</div></div>
        <span class="badge s-${o.status}">${STATUS_LABEL[o.status]}</span><b>${fmt(o.total)}</b></li>`).join('')}</ul>`
    : '<div class="empty"><b>Aucune commande pour le moment</b>Partagez le lien de votre boutique pour recevoir les premières.</div>';
}

export async function loadDashboard(): Promise<void> {
  $('#today').textContent = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  if (!stats) $('#kpis').innerHTML = '<div class="skeleton"></div>'.repeat(4);
  const s = await api<Stats>('/api/admin/stats');
  stats = s;
  $('#kpis').innerHTML = kpis(s);
  renderChart();
  renderStatus(s);
  renderLists(s, s.recent);
}

export function initDashboard(refreshAll: () => Promise<void>): void {
  $('#metric').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
    if (!b) return;
    metric = b.dataset.m as typeof metric;
    $$('#metric button').forEach((x) => x.classList.toggle('on', x === b));
    renderChart();
  });
  $('#kpis').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'pending') { setOrderFilter('en_attente'); nav.goto('commandes'); }
    else { setStockFilter('low'); nav.goto('produits'); }
  });
  $('#low').addEventListener('click', guard(async (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-restock]');
    if (!b) return;
    await send(`/api/admin/products/${b.dataset.restock}/stock`, { delta: 10 }, 'PATCH');
    toast('Stock mis à jour');
    await refreshAll();
  }));
  $('#recent').addEventListener('click', () => nav.goto('commandes'));
}
