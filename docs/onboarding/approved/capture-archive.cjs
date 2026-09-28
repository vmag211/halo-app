// Run with PLAYWRIGHT_MODULE set to a local Playwright installation when needed.
// Regenerates documentation screenshots, not the immutable approved fragment.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const captures = [];
  const errors = [];
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [375, 320]) {
        const context = await browser.newContext({
          viewport: { width: width + 32, height: 1100 },
          colorScheme: theme,
          reducedMotion: 'reduce',
          offline: true,
          deviceScaleFactor: 1,
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        await page.goto(pathToFileURL(path.join(__dirname, 'halo-onboarding-wireframes.offline.html')).href);
        const ui = page.frameLocator('iframe');
        await ui.locator('#halo-product').waitFor();
        const frame = page.frames()[1];
        await frame.waitForFunction(() => !!globalThis.lucide);
        await frame.evaluate(async () => { await document.fonts.ready; });
        await frame.evaluate(() => globalThis.lucide.createIcons({ attrs: { width: 18, height: 18, 'stroke-width': 1.8 } }));
        for (let screen = 0; screen < 5; screen++) {
          await ui.locator('#halo-screen').selectOption(String(screen));
          const states = await ui.locator('#halo-state option').evaluateAll((options) => options.map((option) => ({value: option.value, label: option.textContent})));
          for (const state of states) {
            await ui.locator('#halo-state').selectOption(state.value);
            await frame.evaluate(async () => { await document.fonts.ready; });
            const measurement = await ui.locator('#halo-product').evaluate((product) => ({
              width: product.getBoundingClientRect().width,
              height: product.getBoundingClientRect().height,
              overflow: product.scrollWidth > product.clientWidth,
              fonts: { instrumentSans: document.fonts.check('400 16px "Instrument Sans"'), fraunces: document.fonts.check('600 26px Fraunces') },
              heading: product.querySelector('h1')?.getAttribute('aria-label') || product.querySelector('h1')?.textContent,
              handwriting: product.querySelector('canvas')?.dataset.writing,
            }));
            if (measurement.overflow) errors.push(`Overflow ${theme}/${width}/${screen}/${state.value}`);
            const filename = `${theme}-${width}-${screen + 1}-${state.value}.png`;
            await ui.locator('#halo-product').screenshot({ path: path.join(__dirname, 'screenshots', filename), animations: 'disabled' });
            captures.push({ theme, width, screen: screen + 1, state: state.value, label: state.label, file: `screenshots/${filename}`, ...measurement });
          }
        }
        await context.close();
        console.log(`${theme} ${width}: captured all 44 states offline`);
      }
    }
    const animatedContext = await browser.newContext({
      viewport: { width: 407, height: 1100 }, colorScheme: 'light',
      reducedMotion: 'no-preference', offline: true, deviceScaleFactor: 1,
    });
    const animatedPage = await animatedContext.newPage();
    animatedPage.on('pageerror', (error) => errors.push(String(error)));
    await animatedPage.goto(pathToFileURL(path.join(__dirname, 'halo-onboarding-wireframes.offline.html')).href);
    const animatedUi = animatedPage.frameLocator('iframe');
    await animatedUi.locator('#halo-product').waitFor();
    await animatedPage.frames()[1].evaluate(async () => { await document.fonts.ready; });
    await animatedUi.locator('#halo-screen').selectOption('1');
    await animatedUi.locator('#halo-screen').selectOption('0');
    const animationCaptures = [];
    for (const [wait, label] of [[500, 'start'], [1300, 'middle'], [2300, 'complete']]) {
      await animatedPage.waitForTimeout(wait);
      const status = await animatedUi.locator('#halo-product').evaluate((product) => ({
        writing: product.querySelector('canvas').dataset.writing,
        subtitleOpacity: Number(getComputedStyle(product.querySelector('.halo-welcome-subtitle')).opacity),
        getStartedEnabled: !product.querySelector('[data-action="next"]').disabled,
      }));
      if (label !== 'complete' && (status.writing !== 'writing' || status.subtitleOpacity !== 0)) errors.push(`Incorrect animation phase: ${label}`);
      if (label === 'complete' && (status.writing !== 'complete' || status.subtitleOpacity !== 1)) errors.push('Animation did not complete');
      if (!status.getStartedEnabled) errors.push('Animation blocked Get started');
      const file = `screenshots/animation-${label}.png`;
      await animatedUi.locator('#halo-product').screenshot({ path: path.join(__dirname, file) });
      animationCaptures.push({ file, ...status });
    }
    // The archived prototype remains interactive offline, not only a screenshot.
    await animatedUi.getByRole('button', { name: 'Get started', exact: true }).click();
    await animatedUi.locator('#halo-address').fill('28025');
    await animatedUi.getByRole('button', { name: 'Continue', exact: true }).click();
    await animatedUi.getByRole('button', { name: 'Skip this', exact: true }).click();
    await animatedUi.locator('#halo-water').selectOption('City or town water');
    await animatedUi.getByRole('button', { name: 'See my results', exact: true }).click();
    await animatedUi.getByRole('button', { name: 'See my results', exact: true }).click();
    await animatedUi.locator('#halo-review-status').filter({ hasText: 'Onboarding complete' }).waitFor();
    await animatedContext.close();
    const report = { capturedAt: new Date().toISOString(), browser: await browser.version(), screenshotCount: captures.length + animationCaptures.length, offlineFlowPassed: true, errors, captures, animationCaptures };
    fs.writeFileSync(path.join(__dirname, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${report.screenshotCount} screenshots, offline flow and animation passed, no runtime errors or product overflow.`);
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
