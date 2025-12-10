import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Railway/Cloud platforms inject PORT env variable
const port = parseInt(process.env.PORT || '8080', 10);

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  preview: {
    port: port,
    host: '0.0.0.0',
  },
  plugins: [react()],
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
