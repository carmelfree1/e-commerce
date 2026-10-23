import { build, context, type BuildOptions } from 'esbuild';

const watch = process.argv.includes('--watch');
const withServer = process.argv.includes('--server');

const client: BuildOptions = {
  entryPoints: {
    shop: 'src/client/shop/main.ts',
    admin: 'src/client/admin/main.ts',
    login: 'src/client/admin/login.ts',
    forgot: 'src/client/admin/forgot.ts',
  },
  outdir: 'public/assets',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info',
};

const sw: BuildOptions = {
  entryPoints: { sw: 'src/client/sw.ts' },
  outdir: 'public',
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: !watch,
  logLevel: 'info',
};

const server: BuildOptions = {
  entryPoints: { server: 'src/server/index.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
};

const jobs = [client, sw, ...(withServer ? [server] : [])];
if (watch) {
  for (const j of jobs) await (await context(j)).watch();
} else {
  await Promise.all(jobs.map((j) => build(j)));
}
