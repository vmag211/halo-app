// Captures candidates only. Sealing is a separate, one-time operation.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS preservation tool. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { chromium } = require('@playwright/test');
const { cases, widths, appearances, fixedTime, viewportHeight } = require('./visual-cases.cjs');

const sourceCommit = 'd703965f8348757b599fb04ef3b27b2a9d89916a';
const repositorySourceCommit = '72a2c5150ecfe354fa6b534781e8b6b090d0bda1';
const hash = value => createHash('sha256').update(value).digest('hex');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  }).sort();
}
function filesManifest(directory) {
  return walk(directory).map(file => ({ path: path.relative(directory, file).replaceAll('\\', '/'), bytes: fs.statSync(file).size, sha256: hash(fs.readFileSync(file)) }));
}
function argument(name) { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

async function serve(directory, port = 3012) {
  const root = path.resolve(directory);
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const requested = path.resolve(root, `.${pathname}`);
    if (!requested.startsWith(`${root}${path.sep}`) && requested !== root) { response.writeHead(403).end(); return; }
    if (pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403).end(); return; }
    const file = [requested, path.join(requested, 'index.html'), `${requested}.html`].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (request.method === 'HEAD') response.end(); else fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

async function capture({ baseURL, output, selectedCases = cases }) {
  if (fs.existsSync(output)) throw new Error(`Capture destination already exists: ${output}`);
  fs.mkdirSync(path.join(output, 'screenshots'), { recursive: true });
  const failures = [];
  const captures = [];
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
  const browserVersion = browser.version();
  const baseOrigin = new URL(baseURL).origin;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) throw new Error('Only a localhost comparison target is allowed.');
  try {
    for (const appearance of appearances) for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: viewportHeight }, colorScheme: appearance, reducedMotion: 'reduce', deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'America/New_York', serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== baseOrigin || url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(route.request().method())) {
          failures.push(`Forbidden request: ${route.request().method()} ${url.href}`); await route.abort('blockedbyclient'); return;
        }
        await route.continue();
      });
      await context.routeWebSocket('**/*', socket => { failures.push(`Forbidden WebSocket: ${socket.url()}`); socket.close(); });
      for (const entry of selectedCases) {
        const page = await context.newPage();
        const prefix = `${appearance}-${width}-${entry.id}`;
        page.on('pageerror', error => failures.push(`${prefix}: ${error.message}`));
        page.on('response', response => { if (response.status() >= 400) failures.push(`${prefix}: HTTP ${response.status()} ${response.url()}`); });
        await page.clock.setFixedTime(new Date(fixedTime));
        const url = new URL(entry.path, baseURL);
        Object.entries({ scenario: entry.scenario || 'shell', appearance, scale: '100', motion: 'reduce', time: 'day', contrast: 'false', ...(entry.tab ? { tab: entry.tab } : {}) }).forEach(([key, value]) => url.searchParams.set(key, value));
        await page.goto(url.href, { waitUntil: 'networkidle' });
        await page.getByTestId('foundation-product').waitFor();
        // Review controls are outside the approved app surface. Hiding that
        // sibling preserves the app CSS and makes its top coincide with y=0.
        await page.addStyleTag({ content: '.halo-f-review-tools { display:none !important; }' });
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(img => img.decode().catch(() => {}))); window.scrollTo(0, 0); });
        await page.waitForFunction(() => document.fonts.status === 'loaded');
        if (entry.luna) {
          await page.locator('.halo-f-assistant').click();
          await page.getByRole('dialog', { name: 'Luna' }).waitFor();
          if (entry.luna === 'conversation') {
            await page.locator('.halo-luna-prompts button').first().click();
            await page.locator('.halo-luna-message--assistant').waitFor();
            await page.locator('.halo-luna-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
          }
        }
        await page.mouse.move(width - 1, 1);
        const measurement = await page.getByTestId('foundation-product').evaluate(product => ({
          productWidth: product.getBoundingClientRect().width,
          productHeight: product.getBoundingClientRect().height,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth || product.scrollWidth > product.clientWidth,
          heading: product.querySelector('h1')?.textContent,
          fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
          text: product.innerText,
          elements: [...product.querySelectorAll('h1,h2,h3,button,a,input,textarea,select,summary,[role],[aria-label]')].map(element => ({ tag: element.tagName.toLowerCase(), role: element.getAttribute('role'), label: element.getAttribute('aria-label') || element.textContent.trim(), href: element.getAttribute('href'), disabled: element.hasAttribute('disabled') })),
        }));
        if (measurement.horizontalOverflow) failures.push(`${prefix}: horizontal overflow`);
        const file = `screenshots/${prefix}.png`;
        const options = { fullPage: !entry.luna, animations: 'disabled', caret: 'hide' };
        let previous = await page.screenshot(options);
        let stable = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const current = await page.screenshot(options);
          if (current.equals(previous)) { stable = true; break; }
          previous = current;
        }
        if (!stable) failures.push(`${prefix}: screenshot did not stabilize`);
        fs.writeFileSync(path.join(output, file), previous);
        captures.push({ id: entry.id, appearance, width, height: viewportHeight, path: entry.path, scenario: entry.scenario || 'shell', tab: entry.tab || null, luna: entry.luna || null, file, ...measurement });
        await page.close();
      }
      await context.close();
      console.log(`${appearance} ${width}: ${selectedCases.length} captures`);
    }
  } finally { await browser.close(); }
  const report = { sourceCommit, siteVersion: 8, browser: browserVersion, platform: process.platform, architecture: process.arch, playwrightVersion: require('@playwright/test/package.json').version, fixedTime, timezone: 'America/New_York', locale: 'en-US', sceneTime: 'day', motion: 'reduce', viewportHeight, deviceScaleFactor: 1, reviewControls: 'External review controls hidden; product DOM and styles unchanged.', networkPolicy: 'Only GET/HEAD to the exact localhost origin; /api requests and WebSockets blocked.', screenshotCount: captures.length, failures, captures };
  report.repositorySourceCommit = repositorySourceCommit;
  report.browserArguments = ['--disable-gpu'];
  report.stabilization = 'Two consecutive byte-identical screenshots, maximum six attempts.';
  writeJson(path.join(output, 'capture-report.json'), report);
  if (failures.length) throw new Error(failures.join('\n'));
  return report;
}

async function main() {
  const output = path.resolve(argument('--output') || path.join(os.tmpdir(), `halo-approved-candidate-${Date.now()}`));
  if (output === __dirname || output.startsWith(`${__dirname}${path.sep}`)) throw new Error('Candidates must be written outside the immutable approval directory.');
  let exportPath = argument('--export');
  let server;
  let extracted;
  try {
    if (!argument('--base-url')) {
      if (!exportPath) {
        extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'halo-approved-export-'));
        const result = spawnSync('tar', ['-xzf', path.join(__dirname, 'approved-export.tar.gz'), '-C', extracted], { stdio: 'inherit' });
        if (result.status !== 0) throw new Error('Could not extract approved export.');
        exportPath = extracted;
      }
      server = await serve(exportPath);
    }
    await capture({ baseURL: argument('--base-url') || 'http://127.0.0.1:3012', output, selectedCases: argument('--case') ? cases.filter(entry => entry.id === argument('--case')) : cases });
    if (exportPath) writeJson(path.join(output, 'export-manifest.json'), { algorithm: 'SHA-256', files: filesManifest(exportPath) });
    console.log(`Candidate captures: ${output}`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    // Temporary extraction is retained for inspection, never an approval input.
    if (extracted) console.log(`Temporary export: ${extracted}`);
  }
}
module.exports = { capture, serve, filesManifest, hash, walk, sourceCommit, repositorySourceCommit, writeJson };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
