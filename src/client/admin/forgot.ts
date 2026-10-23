import { $, errMsg } from '../shared/dom';
import { send } from '../shared/api';

const step1 = $<HTMLFormElement>('#step1');
const step2 = $<HTMLFormElement>('#step2');
const done = $('#done');
const resend = $<HTMLButtonElement>('#resend');
let email = '';
let timer: number | undefined;

const field = (f: HTMLFormElement, n: string) => (f.elements.namedItem(n) as HTMLInputElement).value;
const showError = (id: string, msg: string) => { const e = $(id); e.textContent = msg; e.hidden = false; };
const hideError = (id: string) => { $(id).hidden = true; };

/** Bouton « Renvoyer » désactivé 60 s après chaque envoi. */
function cooldown(seconds = 60): void {
  window.clearInterval(timer);
  let left = seconds;
  const tick = () => {
    resend.disabled = left > 0;
    resend.textContent = left > 0 ? `Renvoyer le code (${left} s)` : 'Renvoyer le code';
    left--;
    if (left < -1) window.clearInterval(timer);
  };
  tick();
  timer = window.setInterval(tick, 1000);
}

async function requestCode(): Promise<void> {
  await send('/api/admin/forgot', { email });
}

step1.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError('#err1');
  const btn = $<HTMLButtonElement>('button[type=submit]', step1);
  btn.disabled = true;
  try {
    email = field(step1, 'email').trim().toLowerCase();
    await requestCode();
    // Message volontairement identique que le compte existe ou non : on ne révèle pas quels emails sont enregistrés.
    $('#sent-to').textContent = `Si un compte correspond à ${email}, un code à 6 chiffres vient d'y être envoyé. Il est valable 10 minutes.`;
    step1.hidden = true; step2.hidden = false;
    $('#dot2').classList.add('on');
    $<HTMLInputElement>('input[name=code]', step2).focus();
    cooldown();
  } catch (x) {
    showError('#err1', errMsg(x));
  } finally {
    btn.disabled = false;
  }
});

// Seuls les chiffres sont acceptés dans le champ du code.
$<HTMLInputElement>('input[name=code]', step2).addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  el.value = el.value.replace(/\D/g, '').slice(0, 6);
});

step2.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError('#err2');
  if (field(step2, 'password') !== field(step2, 'confirm')) { showError('#err2', 'Les deux mots de passe ne sont pas identiques.'); return; }
  const btn = $<HTMLButtonElement>('button[type=submit]', step2);
  btn.disabled = true;
  try {
    await send('/api/admin/reset', { email, code: field(step2, 'code'), password: field(step2, 'password') });
    step2.hidden = true; done.hidden = false;
    $('#dot1').classList.add('on');
    window.clearInterval(timer);
  } catch (x) {
    showError('#err2', errMsg(x));
  } finally {
    btn.disabled = false;
  }
});

resend.addEventListener('click', async () => {
  hideError('#err2');
  try { await requestCode(); cooldown(); $('#sent-to').textContent = `Un nouveau code a été envoyé (l'ancien n'est plus valable).`; }
  catch (x) { showError('#err2', errMsg(x)); }
});
