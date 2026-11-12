import { build } from 'esbuild';
await build({ entryPoints: ['src/preload/index.ts'], outfile: 'dist-electron/preload/index.js', bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
