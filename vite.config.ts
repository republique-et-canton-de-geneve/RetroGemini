import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Railway/Cloud platforms inject PORT env variable
const port = parseInt(process.env.PORT || '8080', 10);
const appVersion = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'app-version.json'), 'utf-8')).version;

export default defineConfig({
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  },
  preview: {
    port: port,
    host: '0.0.0.0',
  },
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
  }
});
