/* Isolated frontend acceptance server. Tests intercept every API/auth request.
 * These public credentials are deliberately fake; never point tests at live auth. */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const next = path.resolve(scriptDir, '../node_modules/next/dist/bin/next');
const env = {
  ...process.env, NODE_ENV: 'production', HALO_STAGE_TEST: '1', HALO_ENABLE_FRONTEND_PREVIEW: '1',
  NEXT_PUBLIC_SUPABASE_URL: 'https://halo-test.supabase.co',
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
  await run(['build']);
  if (!process.argv.includes('--build-only')) await run(['start', '--hostname', '127.0.0.1', '--port', '3014']);
})().catch(error => { console.error(error.message); process.exit(1); });
