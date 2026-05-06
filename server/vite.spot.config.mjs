import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: 'public/assets',
    emptyOutDir: false,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve('src/pwa/spot-reown-wallet.jsx'),
      formats: ['es'],
      fileName: () => 'spot-reown-wallet.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) => assetInfo.name === 'style.css' ? 'spot-reown-wallet.css' : '[name][extname]',
      },
    },
  },
});
