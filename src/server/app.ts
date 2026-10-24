import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import path from 'node:path';
import net from 'node:net';
import { config } from './config.js';
import { HttpError, audit, rateLimiter } from './security.js';
import { publicRouter } from './routes/public.js';
import { adminRouter } from './routes/admin.js';
import { renderShop } from './shopHtml.js';
import { IMAGE_FILE_RE, getImage } from './images.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  // IP réelle du visiteur. Derrière Render, `trust proxy` seul donne l'IP d'un relais interne (la même pour tous les visiteurs ou
  // changeante d'une requête à l'autre) : toute la limitation de débit par IP devenait inopérante. On lit donc l'en-tête posé par Cloudflare.
  app.use((req, _res, next) => {
    if (config.clientIpHeader) {
      const v = req.get(config.clientIpHeader)?.trim();
      if (v && net.isIP(v)) Object.defineProperty(req, 'ip', { value: v, configurable: true });
    }
    next();
  });
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'"], fontSrc: ["'self'"], connectSrc: ["'self'"], manifestSrc: ["'self'"], workerSrc: ["'self'"],
        objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
  }));

  app.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    next();
  });
  // Sonde de santé de l'hébergeur : volontairement SANS accès à la base (sinon une base serverless ne se mettrait jamais en veille).
  app.get('/healthz', (_req, res) => { res.set('Cache-Control', 'no-store').type('text').send('ok'); });
  app.use(compression());

  // Plafond global par IP : amortit les inondations et le scraping.
  const apiLimit = rateLimiter(600, 60e3);
  app.use('/api', (req, _res, next) => {
    if (!apiLimit.take(req.ip || '')) { audit('rate_limited', { ip: req.ip, path: req.path }); return next(new HttpError(429, 'Trop de requêtes')); }
    next();
  });

  // CSRF, défense en profondeur (en plus du cookie SameSite=Strict) : toute écriture venant d'un autre site est refusée.
  app.use('/api', (req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    let cross = req.get('sec-fetch-site') === 'cross-site';
    if (origin && !cross) {
      try { cross = new URL(origin).host.toLowerCase() !== req.host.toLowerCase(); } catch { cross = true; }
    }
    if (cross) { audit('csrf_blocked', { ip: req.ip, origin, path: req.path }); return next(new HttpError(403, 'Origine non autorisée')); }
    next();
  });

  app.use('/api', express.json({ limit: '50kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api/admin', adminRouter);
  app.use('/api', publicRouter);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Introuvable')));

  // Page d'accueil : catalogue embarqué dans le HTML (affichage immédiat, zéro requête API au démarrage).
  app.get(['/', '/index.html'], async (_req, res) => {
    res.set('Cache-Control', 'no-cache').type('html').send(await renderShop());
  });
  // Fichiers référencés avec ?v=<horodatage> : cache d'un an.
  app.use((req, res, next) => {
    if (typeof req.query.v === 'string' && /^\d+$/.test(req.query.v)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    next();
  });

  // Photos produits : lues dans la base (noms aléatoires → contenu immuable, cache d'un an, ETag = nom du fichier).
  app.get('/uploads/:file', async (req, res, next) => {
    const file = String(req.params.file);
    if (!IMAGE_FILE_RE.test(file)) return next();
    const img = await getImage(file);
    if (!img) return next(); // repli : anciens fichiers du disque (développement)
    res.set({ 'Content-Type': img.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', ETag: `"${file}"` });
    if (req.fresh) { res.status(304).end(); return; }
    res.send(img.data);
  });
  app.use('/uploads', express.static(config.uploadDir, {
    maxAge: '30d', immutable: true, setHeaders: (r) => { r.set('X-Content-Type-Options', 'nosniff'); },
  }));
  app.get('/sw.js', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(config.publicDir, 'sw.js')); });
  app.use('/admin', (_req, res, next) => { res.set('X-Robots-Tag', 'noindex'); next(); });
  app.use(express.static(config.publicDir, {
    extensions: ['html'],
    setHeaders: (res, file) => {
      // Icônes et manifeste changent rarement : 7 jours. Le reste est revalidé (ETag → 304 instantané).
      if (/[\\/]icons[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=604800');
    },
  }));

  // Page 404 générique (la page par défaut d'Express révèle la technologie : « Cannot GET »).
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.status(404).set('Cache-Control', 'no-store').type('html').send(
      '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page introuvable</title>'
      + '<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f6f4;color:#111a14;text-align:center">'
      + '<div><h1 style="margin:0 0 8px">Page introuvable</h1><p style="color:#667068">Cette page n\'existe pas ou a été déplacée.</p>'
      + '<a href="/" style="display:inline-block;margin-top:12px;background:#0f5a2c;color:#fff;text-decoration:none;padding:10px 22px;border-radius:999px;font-weight:700">Retour à la boutique</a></div></body></html>');
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number; message?: string };
    if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
    if (e.type === 'entity.too.large') return void res.status(413).json({ error: 'Fichier trop volumineux' });
    if (e.type === 'entity.parse.failed') return void res.status(400).json({ error: 'JSON invalide' });
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  });
  return app;
}
