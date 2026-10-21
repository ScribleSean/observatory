import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

// Builds the read-only dashboard into dist/dashboard. serve-local.mjs serves it.
export default defineConfig({
  root:fileURLToPath(new URL('./app/web',import.meta.url)),
  base:'./',
  publicDir:false,
  plugins:[react()],
  build:{outDir:fileURLToPath(new URL('./dist/dashboard',import.meta.url)),emptyOutDir:true},
});
