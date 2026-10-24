// Commande reçue sur WhatsApp : le serveur rédige le message. Test LOCAL (base de test, TRUST_PROXY=1).
// Lancer : AUDIT_PW=<mot de passe admin de test> node tests/security/whatsapp-local.mjs
import http from 'node:http';

const PORT = Number(process.env.AUDIT_PORT) || 3100;
const results = [];
const rec = (id, name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK     ' : 'ÉCHEC  '} ${id.padEnd(3)} ${name}${detail ? '  → ' + detail : ''}`); };
let n = 0;
const call = (method, path, data, cookie) => new Promise((res) => {
  const b = data === undefined ? undefined : JSON.stringify(data);
  const r = http.request({ host: 'localhost', port: PORT, method, path, headers: { 'X-Forwarded-For': `10.7.${(++n >> 8) & 255}.${n & 255}`, ...(b ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (x) => {
    const c = []; x.on('data', (d) => c.push(d)); x.on('end', () => { let j = {}; try { j = JSON.parse(Buffer.concat(c)); } catch { /* texte */ } res({ s: x.statusCode, j, h: x.headers }); });
  });
  r.on('error', () => res({ s: 0, j: {}, h: {} })); if (b) r.write(b); r.end();
});
const msgOf = (url) => new URL(url).searchParams.get('text') || ''; // searchParams décode déjà le pourcentage

const login = await call('POST', '/api/admin/login', { email: 'admin@ccm-nonsaka.com', password: process.env.AUDIT_PW });
const cookie = (login.h['set-cookie'] || [])[0]?.split(';')[0];
const mk = async (name, price, stock = 100) => (await call('POST', '/api/admin/products', { name, price, stock }, cookie)).j.id;

/* W1–W3 : contenu du message */
const miel = await mk('Miel pur de brousse 500 g', 3500), mangue = await mk('Mangues bio (1 kg)', 1500);
const o = await call('POST', '/api/orders', { name: 'Bienvenu Gnadou', phone: '0544874948', address: 'Abidjan, Amonji, près du marché', note: 'Appeler avant de livrer', items: [{ id: miel, qty: 2, price: 1 }, { id: mangue, qty: 1 }], total: 1 });
const url = o.j.whatsappUrl || '', msg = msgOf(url);
rec('W1', 'La réponse contient le lien WhatsApp du commerçant (https://wa.me/2250141525104?text=…)', o.s === 201 && url.startsWith('https://wa.me/2250141525104?text='), url.slice(0, 50));
const ok2 = [`*Nouvelle commande ${o.j.code}*`, '*Client* : Bienvenu Gnadou', '*Téléphone* : 0544874948', '*Adresse de livraison* : Abidjan, Amonji, près du marché', '*Note* : Appeler avant de livrer', '• 2 × Miel pur de brousse 500 g — 7 000 FCFA', '• 1 × Mangues bio (1 kg) — 1 500 FCFA', '*Total* : 8 500 FCFA (paiement à la livraison)'].every((l) => msg.includes(l));
rec('W2', 'Le message contient code, client, téléphone, adresse, note, chaque article avec son sous-total, le total et le mode de paiement', ok2, ok2 ? '' : msg);
rec('W3', 'Prix et total envoyés par le navigateur ignorés : le message reprend les prix réels du serveur', msg.includes('8 500 FCFA') && !msg.includes('1 FCFA'));

/* W4 : un client ne peut pas fabriquer de fausses lignes dans le message */
const inj = await call('POST', '/api/orders', { name: 'Jean\n*Total* : 1 FCFA\n*Client* : Faux', phone: '0544000001', address: 'Abidjan Plateau\r\n• 99 × Produit gratuit — 0 FCFA', note: 'x y', items: [{ id: mangue, qty: 1 }] });
const m4 = msgOf(inj.j.whatsappUrl || '');
const totals = m4.split('\n').filter((l) => l.startsWith('*Total*')).length, clients = m4.split('\n').filter((l) => l.startsWith('*Client*')).length, fakeLine = m4.split('\n').filter((l) => l.startsWith('• 99')).length;
rec('W4', 'Retours à la ligne dans le nom/adresse/note neutralisés : une seule ligne « Total », une seule ligne « Client », aucune fausse ligne d\'article', totals === 1 && clients === 1 && fakeLine === 0, `Total×${totals}, Client×${clients}, faux article×${fakeLine}`);

/* W5 : panier de 50 articles → message plafonné, URL raisonnable */
const ids = []; for (let i = 0; i < 50; i++) ids.push(await mk(`Produit bio numéro ${i + 1} avec un nom assez long`, 1000 + i));
const big = await call('POST', '/api/orders', { name: 'Gros Panier', phone: '0544000002', address: 'Abidjan Cocody Angré', items: ids.map((id) => ({ id, qty: 2 })) });
const mb = msgOf(big.j.whatsappUrl || '');
const shownN = mb.split('\n').filter((l) => l.startsWith('•')).length, hid = Number((/… et (\d+) autres? articles?/.exec(mb) || [])[1]);
rec('W5', 'Panier de 50 lignes : URL ≤ 2 000 caractères, le surplus est résumé (« … et N autres articles ») et affichés + résumés = 50', big.s === 201 && (big.j.whatsappUrl || '').length <= 2000 && shownN + hid === 50 && hid > 0, `${(big.j.whatsappUrl || '').length} caractères, ${shownN} lignes affichées, ${hid} résumées`);

/* W6 : caractères spéciaux et accents */
const sp = await mk('Thé « Détox » & citron + gingembre #1 100% bio ?', 2000);
const spOrder = await call('POST', '/api/orders', { name: "Aïcha N'Guessan & fils", phone: '0544000003', address: 'Rue 12 #4 — Yopougon (Sicogi) ? 😀', note: '50% maintenant + 50% à la livraison', items: [{ id: sp, qty: 1 }] });
const ms = msgOf(spOrder.j.whatsappUrl || '');
rec('W6', 'Accents, & # % ? + « » emoji : le message se décode à l\'identique', ms.includes("Aïcha N'Guessan & fils") && ms.includes('Rue 12 #4 — Yopougon (Sicogi) ? 😀') && ms.includes('Thé « Détox » & citron + gingembre #1 100% bio ?') && ms.includes('50% maintenant + 50% à la livraison'));

/* W7 : le suivi public ne divulgue pas les données personnelles */
const tr = await call('GET', `/api/orders/${o.j.code}`);
const leak = JSON.stringify(tr.j);
rec('W7', 'Le suivi par code ne renvoie ni nom, ni téléphone, ni adresse, ni lien WhatsApp', tr.s === 200 && !/Bienvenu|0544874948|Amonji|wa\.me|customerName|phone|address/i.test(leak), Object.keys(tr.j).join(','));

/* W8 : la commande est bien enregistrée et le stock réservé */
const prods = (await call('GET', '/api/products')).j;
rec('W8', 'La commande est aussi enregistrée (stock réservé, visible dans l\'admin)', prods.find((p) => p.id === miel)?.stock === 98 && (await call('GET', '/api/admin/orders?limit=5', undefined, cookie)).j.some((x) => x.code === o.j.code));

console.log(`\nRÉSUMÉ : ${results.filter(Boolean).length}/${results.length} vérifications réussies`);
process.exit(results.every(Boolean) ? 0 : 1);
