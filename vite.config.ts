import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client' },
  server: {
    strictPort: true,
    host: '127.0.0.1',
    watch: {
      ignored: ['**/reference/**'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4310',
        ws: true,
      },
    },
  },
  test: {
    include: ['tests/**/*.{test,spec}.{js,mjs,ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'reference/**'],
  },
});
