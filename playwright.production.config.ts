import {defineConfig} from '@playwright/test';

const productionTestUrl=process.env.HALO_PRODUCTION_TEST_URL??'http://127.0.0.1:3014';
if(!['127.0.0.1','localhost'].includes(new URL(productionTestUrl).hostname))throw new Error('Production frontend tests require an isolated local server.');

/** All service/auth calls are intercepted. Never run this against a deployed app. */
export default defineConfig({
 testDir:'./test/ui',testMatch:'production-*.spec.ts',fullyParallel:true,workers:2,
 timeout:45000,expect:{timeout:10000},updateSnapshots:'none',
 outputDir:'test-results-production-frontend',reporter:[['list'],['html',{open:'never',outputFolder:'playwright-report/production-frontend'}]],
 use:{baseURL:productionTestUrl,browserName:'chromium',channel:'chrome',viewport:{width:375,height:850},colorScheme:'light',contextOptions:{reducedMotion:'reduce',serviceWorkers:'block'},screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:process.env.HALO_PRODUCTION_TEST_URL?undefined:{command:'node scripts/stage-test-server.mjs',url:'http://127.0.0.1:3014/learn',reuseExistingServer:false,timeout:240000},
});
