import { $, errMsg } from '../shared/dom';
import { api, send } from '../shared/api';

const form = $<HTMLFormElement>('#login');
const err = $('#err');

// Déjà connecté : on file directement au tableau de bord.
api('/api/admin/me').then(() => location.replace('/admin/')).catch(() => undefined);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const btn = $<HTMLButtonElement>('button[type=submit]', form);
  btn.disabled = true;
  try {
    await send('/api/admin/login', {
      email: (form.elements.namedItem('email') as HTMLInputElement).value,
      password: (form.elements.namedItem('password') as HTMLInputElement).value,
    });
    location.replace('/admin/');
  } catch (x) {
    err.textContent = errMsg(x);
    err.hidden = false;
    btn.disabled = false;
  }
});
