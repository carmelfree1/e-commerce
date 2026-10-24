// Génère toutes les images de marque à partir du logo d'origine (branding/logo-source.webp) :
// logo web, icônes PWA (normale + « maskable »), icône iOS et favicons.
// Usage : npm run icons   (sharp est une dépendance de développement ; les images générées sont versionnées)
import fs from 'node:fs';
import sharp from 'sharp';

const SOURCE = 'branding/logo-source.webp';
const OUT = 'public/icons';
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

fs.mkdirSync(OUT, { recursive: true });
const logo = (size: number) => sharp(SOURCE).resize(size, size, { fit: 'cover' });

const jobs: [string, Promise<unknown>][] = [
  // Logo affiché dans les en-têtes (affiché à 40–64 px : 256 px suffit pour les écrans Retina)
  ['logo.webp', logo(256).webp({ quality: 90 }).toFile(`${OUT}/logo.webp`)],
  // Icônes PWA
  ['icon-96.png', logo(96).png({ compressionLevel: 9 }).toFile(`${OUT}/icon-96.png`)],
  ['icon-192.png', logo(192).png({ compressionLevel: 9 }).toFile(`${OUT}/icon-192.png`)],
  ['icon-512.png', logo(512).png({ compressionLevel: 9 }).toFile(`${OUT}/icon-512.png`)],
  // Icône « maskable » : le système peut la rogner (cercle, carré arrondi…) ; le logo est réduit à 78 % pour rester dans la zone sûre
  ['icon-maskable-512.png', sharp({ create: { width: 512, height: 512, channels: 4, background: WHITE } })
    .composite([{ input: await logo(400).png().toBuffer(), gravity: 'centre' }]).png({ compressionLevel: 9 }).toFile(`${OUT}/icon-maskable-512.png`)],
  // iOS (Ajouter à l'écran d'accueil) et favicons
  ['apple-touch-icon.png', logo(180).png({ compressionLevel: 9 }).toFile(`${OUT}/apple-touch-icon.png`)],
  ['favicon-32.png', logo(32).png({ compressionLevel: 9 }).toFile(`${OUT}/favicon-32.png`)],
];

for (const [name, job] of jobs) {
  await job;
  console.log(`✔ ${OUT}/${name}  (${(fs.statSync(`${OUT}/${name}`).size / 1024).toFixed(1)} Ko)`);
}
