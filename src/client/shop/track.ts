import type { TrackedOrder } from '../../shared/types';
import { $, esc, errMsg, fmt } from '../shared/dom';
import { api } from '../shared/api';
import { openPanel } from './cart';

const FLOW = [['en_attente', 'Commande reçue'], ['confirmee', 'Confirmée'], ['en_livraison', 'En livraison'], ['livree', 'Livrée']] as const;

async function track(code: string): Promise<void> {
  const out = $('#track-result');
  try {
    const o = await api<TrackedOrder>('/api/orders/' + encodeURIComponent(code.trim()));
    const at = FLOW.findIndex((s) => s[0] === o.status);
    out.innerHTML = `<p><b>${esc(o.code)}</b> — ${fmt(o.total)}</p><ul class="steps">`
      + (o.status === 'annulee'
        ? '<li class="cancel">Commande annulée</li>'
        : FLOW.map((s, i) => `<li class="${i <= at ? 'done' : ''}">${s[1]}</li>`).join(''))
      + `</ul><p class="muted">${o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join(', ')}</p>`;
  } catch (x) {
    out.innerHTML = `<p class="error">${esc(errMsg(x))}</p>`;
  }
}

export function openTrack(code?: string): void {
  openPanel(null);
  $<HTMLDialogElement>('#dlg-track').showModal();
  if (code) { $<HTMLInputElement>('#track-code').value = code; void track(code); }
}

export function initTrack(): void {
  const open = () => {
    let last = '';
    try { last = localStorage.getItem('ccm-last') || ''; } catch { /* ignoré */ }
    openTrack(last);
  };
  $('#menu-track').addEventListener('click', open);
  $('#btn-track').addEventListener('click', open);
  $('#track-form').addEventListener('submit', (e) => { e.preventDefault(); void track($<HTMLInputElement>('#track-code').value); });
}
