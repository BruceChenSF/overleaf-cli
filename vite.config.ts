import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest: manifest as any })
  ],
  build: {
    rollupOptions: {
      input: {
        'background': 'src/background/service-worker.ts',
        'content': 'src/content/injector.ts',
        'terminal': 'src/terminal/index.html'
      }
    }
  }
});
