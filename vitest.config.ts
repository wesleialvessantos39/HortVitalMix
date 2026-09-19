import { defineConfig } from 'vitest/config';
export default defineConfig({
  test:{
    environment:'node',
    globals:true,
    setupFiles:['./tests/setup/startup.ts','./tests/setup/globalSetup.ts'],
    testTimeout:20_000,
    hookTimeout:20_000,
    coverage:{enabled:false}
  }
});
