import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.VITE_DEV_API ?? 'http://localhost:4000', changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { '/api': { target: 'http://localhost:4000' } } },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-dom/client', 'react-router'],
          codemirror: [
            '@uiw/react-codemirror',
            '@codemirror/view',
            '@codemirror/state',
            '@codemirror/lang-json',
            '@codemirror/lang-yaml',
          ],
        },
      },
    },
  },
  define: { 'process.env.NODE_DEBUG': 'false' },
});
