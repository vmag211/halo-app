/* Isolated frontend acceptance server. Tests intercept every API/auth request.
 * These public credentials are deliberately fake; never point tests at live auth.
 * The Supabase URL is a local placeholder (HALO_STAGE_SUPABASE_URL overrides it,
 * and test/ui/stage-fixtures.ts reads the same variable), so the browser never
 * resolves a public supabase.co host. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const next = path.resolve(scriptDir, '../node_modules/next/dist/bin/next');
const supabaseUrl = process.env.HALO_STAGE_SUPABASE_URL || 'http://127.0.0.1:54321';
if (!['127.0.0.1', 'localhost'].includes(new URL(supabaseUrl).hostname)) throw new Error('Stage tests require a local Supabase placeholder URL.');
const env = {
  ...process.env, NODE_ENV: 'production', HALO_STAGE_TEST: '1', HALO_ENABLE_FRONTEND_PREVIEW: '1',
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImhhbG8tZnJvbnRlbmQtdGVzdCJ9.mock-signature',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
};
let child;
function run(args) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [next, ...args], { cwd: path.resolve(scriptDir, '..'), env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Next exited with ${code}`)));
  });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child?.kill(signal); process.exit(0); });
(async () => {
  await run(['build', ...(process.env.HALO_STAGE_TEST_WEBPACK === '1' ? ['--webpack'] : [])]);
  if (!process.argv.includes('--build-only')) await run(['start', '--hostname', '127.0.0.1', '--port', process.env.HALO_STAGE_TEST_PORT || '3014']);
})().catch(error => { console.error(error.message); process.exit(1); });
