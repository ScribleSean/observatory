import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import {fileURLToPath} from 'node:url';
import {webLicenses} from './web-licenses.mjs';

export default defineConfig({
  root:fileURLToPath(new URL('./web',import.meta.url)),
  base:'./',
  plugins:[react(),webLicenses(fileURLToPath(new URL('..',import.meta.url)))],
  css:{postcss:{plugins:[tailwind()]}},
  resolve:{alias:{'@':fileURLToPath(new URL('..',import.meta.url))}},
  build:{outDir:fileURLToPath(new URL('../.native-build/web',import.meta.url)),emptyOutDir:true,
    rollupOptions:{input:{index:fileURLToPath(new URL('./web/index.html',import.meta.url)),panel:fileURLToPath(new URL('./web/panel.html',import.meta.url))}}},
});
