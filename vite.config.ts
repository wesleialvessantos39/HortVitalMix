import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
  getEnvironmentPolicy,
  resolveAppEnvironment,
} from './shared/environment/policy';

function createLocalApiPlugin(): Plugin {
  return {
    name: 'hortivitalmix-local-api',
    apply: 'serve',
    async configureServer(server) {
      const { createApp } = await import('./server/app');
      const { app, pool } = createApp();

      // Google AI Studio and local Vite preview run a single public process.
      // Mount the exact Express application on the same origin instead of
      // depending on a second localhost:3001 process that may not exist.
      server.middlewares.use(app);

      server.httpServer?.once('close', () => {
        void pool?.end();
      });
    },
  };
}

export default defineConfig(() => {
  const resolved = resolveAppEnvironment(process.env);
  const policy = getEnvironmentPolicy(resolved.environment);

  return {
    plugins: [
      createLocalApiPlugin(),
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
    build: {
      sourcemap: true,
    },
  };
});
