import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./test',testMatch:'review-correction.e2e.ts',fullyParallel:false,workers:1,timeout:60000,
  use:{baseURL:'http://127.0.0.1:18557',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:{command:'node --experimental-strip-types ./test/review-correction-server.ts',url:'http://127.0.0.1:18557/health',reuseExistingServer:false,timeout:30000,gracefulShutdown:{signal:'SIGTERM',timeout:15000}},
  reporter:[['list']],
});
