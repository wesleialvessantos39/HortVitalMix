import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import {
  getEnvironmentPolicy,
  resolveAppEnvironment,
} from './shared/environment/policy';

export default defineConfig(() => {
  const resolved = resolveAppEnvironment(process.env);
  const policy = getEnvironmentPolicy(resolved.environment);

  return {
    plugins: [
      react(),
      {
        name: 'hortivitalmix-environment-indexing',
        transformIndexHtml(html) {
          return {
            html,
            tags: [
              {
                tag: 'meta',
                attrs: {
                  name: 'robots',
                  content: policy.indexingAllowed
                    ? 'index, follow'
                    : 'noindex, nofollow, noarchive',
                },
                injectTo: 'head',
              },
            ],
          };
        },
      },
    ],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});
