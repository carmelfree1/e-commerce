import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.js';

export const mailConfigured = Boolean(config.smtpHost);

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure, // true pour le port 465 ; sinon STARTTLS automatique si le serveur le propose
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

/** Envoie le code de réinitialisation. Sans SMTP : affiché dans la console en développement uniquement (jamais en production). */
export async function sendResetCode(to: string, code: string, minutes: number): Promise<void> {
  if (!mailConfigured) {
    if (config.isProd) console.error('SMTP non configuré : impossible d\'envoyer le code de réinitialisation (voir SMTP_HOST dans .env).');
    else console.log(`[DEV] Code de réinitialisation pour ${to} : ${code} (valable ${minutes} min)`);
    return;
  }
  try {
  await getTransporter().sendMail({
    from: config.mailFrom,
    to,
    subject: `Votre code de réinitialisation : ${code}`,
    text: [
      'Bonjour,',
      '',
      `Voici votre code pour réinitialiser le mot de passe de l'administration CCM-NONSAKA :`,
      '',
      `    ${code}`,
      '',
      `Il est valable ${minutes} minutes et ne peut servir qu'une fois.`,
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
      '',
      'Ne communiquez ce code à personne.',
    ].join('\n'),
    html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111a14">
      <h2 style="margin:0 0 12px;color:#0f5a2c">CCM<span style="color:#d62828">-NONSAKA</span></h2>
      <p>Voici votre code pour réinitialiser le mot de passe de l'administration :</p>
      <p style="font-size:34px;font-weight:800;letter-spacing:10px;background:#e6f1e8;color:#0f5a2c;text-align:center;padding:16px;border-radius:12px;margin:18px 0">${code}</p>
      <p>Il est valable <b>${minutes} minutes</b> et ne peut servir qu'une fois.</p>
      <p style="color:#667068;font-size:13px">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé. Ne communiquez ce code à personne.</p></div>`,
  });
  } catch (e) {
    if (!config.isProd) console.log(`[DEV] Envoi impossible (${(e as Error).message}). Code pour ${to} : ${code} (valable ${minutes} min)`);
    throw e;
  }
}
