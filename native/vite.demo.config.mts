import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {webLicenses} from './web-licenses.mjs';

export default defineConfig({
  root:fileURLToPath(new URL('./web',import.meta.url)),
  base:'/observatory/',
  mode:'demo',
  publicDir:false,
  plugins:[react(),webLicenses(fileURLToPath(new URL('..',import.meta.url))),{
    name:'demo-index',
    enforce:'post',
    generateBundle(_options,bundle) {
      const page=bundle['dashboard.html'];
      if(!page || page.type!=='asset') throw Error('Dashboard HTML was not emitted');
      this.emitFile({type:'asset',fileName:'index.html',source:page.source});
      delete bundle['dashboard.html'];
    },
  }],
  resolve:{alias:{'@':fileURLToPath(new URL('..',import.meta.url))}},
  build:{outDir:fileURLToPath(new URL('../dist/pages',import.meta.url)),emptyOutDir:true,
    rolldownOptions:{input:{dashboard:fileURLToPath(new URL('./web/dashboard.html',import.meta.url)),panel:fileURLToPath(new URL('./web/panel.html',import.meta.url)),product:fileURLToPath(new URL('./web/product.html',import.meta.url))}}},
});
