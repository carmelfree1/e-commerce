// Faux serveur SMTP LOCAL pour tester les emails (reset de mot de passe, confirmations) sans rien envoyer pour de vrai.
// Utilisation :
//   import { startFakeSmtp } from './fake-smtp.mjs';
//   const smtp = await startFakeSmtp(2525);      // lancer l'appli avec SMTP_HOST=localhost SMTP_PORT=2525 (sans identifiants)
//   ... déclencher l'envoi ...
//   const mail = await smtp.waitMail(1);          // n-ième email reçu (ou null après le délai)
//   smtp.codeOf(mail)                             // code à 6 chiffres lu dans le sujet (adapter la regex si besoin)
//   smtp.close();
// Limite : pas de STARTTLS ni d'authentification (volontaire : serveur de test local).
import net from 'node:net';

export async function startFakeSmtp(port = 2525) {
  const mails = [];
  const server = net.createServer((sock) => {
    let inData = false, buf = '', cur = { from: '', to: [], raw: '' };
    sock.write('220 fake-smtp ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          cur.raw = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          mails.push(cur); cur = { from: '', to: [], raw: '' }; sock.write('250 OK queued\r\n');
        } else {
          const i = buf.indexOf('\r\n'); if (i === -1) return;
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          const u = line.toUpperCase();
          if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250-fake\r\n250 8BITMIME\r\n');
          else if (u.startsWith('MAIL FROM')) { cur.from = line; sock.write('250 OK\r\n'); }
          else if (u.startsWith('RCPT TO')) { cur.to.push(line.replace(/^RCPT TO:\s*<?|>?$/gi, '')); sock.write('250 OK\r\n'); }
          else if (u === 'DATA') { inData = true; sock.write('354 go\r\n'); }
          else if (u === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); return; }
          else sock.write('250 OK\r\n');
        }
      }
    });
    sock.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return {
    mails,
    async waitMail(n, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (mails.length >= n) return mails[n - 1]; await new Promise((r) => setTimeout(r, 100)); } return null; },
    /** Code numérique de 6 chiffres lu dans l'en-tête Subject (encodé ou non). */
    codeOf(mail) {
      if (!mail) return undefined;
      const head = mail.raw.split('\r\n\r\n')[0].replace(/\r\n[ \t]+/g, ' ');
      return (/(\d{6})\s*\?=/.exec(head) || /Subject:[^\r\n]*?(\d{6})/.exec(head) || [])[1];
    },
    close() { server.close(); },
  };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('fake-smtp.mjs')) {
  const smtp = await startFakeSmtp(Number(process.env.PORT) || 2525);
  console.log(`Faux SMTP à l'écoute sur localhost:${process.env.PORT || 2525} — Ctrl+C pour arrêter. Chaque email reçu est affiché ci-dessous.`);
  setInterval(() => { while (smtp.mails.length > (smtp._seen ||= 0)) { const m = smtp.mails[smtp._seen++]; console.log(`\n--- email #${smtp._seen} → ${m.to.join(', ')}  (code lu : ${smtp.codeOf(m) ?? '—'})`); } }, 300);
}
