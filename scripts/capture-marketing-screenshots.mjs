// ----------------------------------------------------------------------------
// capture-marketing-screenshots.mjs
//
// Opens the Expo web app, loads demo data, walks major screens, and saves
// PNGs into marketing-screenshots/ for sharing.
//
// Prerequisites: `npm run web` already running (default http://localhost:8081)
//
// Usage:
//   node scripts/capture-marketing-screenshots.mjs              # light → marketing-screenshots/
//   THEME=dark node scripts/capture-marketing-screenshots.mjs  # dark  → marketing-screenshots/dark/
// ----------------------------------------------------------------------------

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const THEME = (
  process.env.THEME
  || (args.includes('--dark') ? 'dark' : 'light')
).toLowerCase(); // light | dark
const OUT = path.resolve(
  __dirname,
  '..',
  'marketing-screenshots',
  THEME === 'dark' ? 'dark' : '',
);
const BASE = process.env.APP_URL || 'http://localhost:8081';
const THEME_STORAGE_KEY = '@financeApp/theme/v1';

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
}

let shotIndex = 0;

function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function capture(page, name) {
  shotIndex += 1;
  const file = path.join(OUT, `${String(shotIndex).padStart(2, '0')}-${slug(name)}.png`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: file, fullPage: false });
  console.log('✓', path.basename(file));
}

async function clickTab(page, label) {
  const tab = page.getByRole('tab', { name: label }).first();
  if (await tab.count()) {
    await tab.click({ timeout: 15000 });
  } else {
    await page.getByText(label, { exact: true }).last().click({ timeout: 15000 });
  }
  await page.waitForTimeout(600);
}

async function openMoreItem(page, name) {
  await clickTab(page, 'More');
  await page.waitForTimeout(400);
  const item = page.getByText(name, { exact: true }).first();
  await item.scrollIntoViewIfNeeded();
  await item.click({ timeout: 15000 });
  await page.waitForTimeout(700);
}

async function goBack(page) {
  const candidates = [
    page.getByLabel(/^back$/i).first(),
    page.getByRole('button', { name: /back/i }).first(),
    page.locator('[aria-label*="Back" i]').first(),
    page.locator('header >> text=‹').first(),
  ];
  for (const c of candidates) {
    try {
      if (await c.count()) {
        await c.click({ timeout: 2000 });
        await page.waitForTimeout(400);
        return;
      }
    } catch {
      // try next
    }
  }
  await clickTab(page, 'More');
  await page.waitForTimeout(400);
}

async function ensureTheme(page) {
  // Seed AsyncStorage (localStorage on web) before first paint when possible,
  // then also click the Settings chip as a hard guarantee.
  if (THEME === 'dark' || THEME === 'light') {
    await page.evaluate(
      ({ key, mode }) => {
        try {
          localStorage.setItem(key, mode);
        } catch {
          // ignore
        }
      },
      { key: THEME_STORAGE_KEY, mode: THEME },
    );
  }

  await openMoreItem(page, 'Settings');
  await page.waitForTimeout(500);

  // Scroll to Appearance section and pick the theme chip.
  const chipLabel = THEME === 'dark' ? 'Theme: dark' : 'Theme: light';
  const chip = page.getByLabel(chipLabel).first();
  if (await chip.count()) {
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await page.waitForTimeout(600);
  } else {
    // Fallback: visible text "Dark" / "Light" in Appearance row
    const text = page.getByText(THEME === 'dark' ? 'Dark' : 'Light', { exact: true }).first();
    if (await text.count()) {
      await text.scrollIntoViewIfNeeded();
      await text.click();
      await page.waitForTimeout(600);
    }
  }
  await goBack(page);
}

async function loadDemoData(page) {
  await openMoreItem(page, 'Settings');
  await page.waitForTimeout(500);

  const demo = page.getByText('Load demo data', { exact: true }).first();
  await demo.scrollIntoViewIfNeeded();

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });
  await demo.click();
  await page.waitForTimeout(2000);
  await goBack(page);
}

async function main() {
  console.log('Opening', BASE, `(theme=${THEME})`);
  console.log('Output →', OUT);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 420, height: 920 },
    deviceScaleFactor: 2,
    colorScheme: THEME === 'dark' ? 'dark' : 'light',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);

  // Pre-set theme in localStorage on first navigation
  await page.addInitScript(
    ({ key, mode }) => {
      try {
        localStorage.setItem(key, mode);
      } catch {
        // ignore
      }
    },
    { key: THEME_STORAGE_KEY, mode: THEME === 'dark' ? 'dark' : 'light' },
  );

  await page.goto(BASE, { waitUntil: 'load', timeout: 180000 });
  await page.getByText('Home', { exact: true }).first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(2500);

  console.log('Loading demo data…');
  await loadDemoData(page);

  console.log(`Forcing ${THEME} theme…`);
  await ensureTheme(page);

  // Tabs
  await clickTab(page, 'Home');
  await capture(page, 'dashboard');
  await page.mouse.wheel(0, 650);
  await capture(page, 'dashboard-spend-chart');
  await page.mouse.wheel(0, -650);

  await clickTab(page, 'Transactions');
  await capture(page, 'transactions-expense');
  const incomeSeg = page.getByText('Income', { exact: true }).first();
  if (await incomeSeg.count()) {
    await incomeSeg.click().catch(() => {});
    await capture(page, 'transactions-income');
  }

  await clickTab(page, 'Invest');
  await capture(page, 'investments');

  const portfolioBtn = page.getByText('Portfolio', { exact: true }).first();
  if (await portfolioBtn.count()) {
    await portfolioBtn.click().catch(() => {});
    await page.waitForTimeout(700);
    await capture(page, 'portfolio');
    await goBack(page);
    await clickTab(page, 'Invest');
  }

  const nwBtn = page.getByText('Net Worth', { exact: true }).first();
  if (await nwBtn.count()) {
    await nwBtn.click().catch(() => {});
    await page.waitForTimeout(700);
    await capture(page, 'net-worth');
  }

  await clickTab(page, 'Insights');
  await capture(page, 'ai-insights');

  const moreScreens = [
    ['Reports', 'reports'],
    ['Cash Flow Forecast', 'cash-flow'],
    ['Search', 'search'],
    ['Budgets', 'budgets'],
    ['Loans', 'loans'],
    ['Goals', 'goals'],
    ['Recurring', 'recurring'],
    ['Transfers (informal)', 'transfers'],
    ['Bank Statement', 'import-bank'],
    ['Transactions CSV', 'import-transactions'],
    ['EMI Calculator', 'emi-calculator'],
    ['SIP Calculator', 'sip-calculator'],
    ['Tax Calculator', 'tax-calculator'],
    ['FIRE Calculator', 'fire-calculator'],
    ['Stock Fundamentals', 'stock-fundamentals'],
    ['Settings', 'settings'],
  ];

  for (const [label, file] of moreScreens) {
    try {
      await openMoreItem(page, label);
      await capture(page, file);
      await goBack(page);
    } catch (e) {
      console.warn('⚠ skipped', label, '-', e.message.split('\n')[0]);
      await clickTab(page, 'More').catch(() => {});
    }
  }

  // Categories via Settings
  try {
    await openMoreItem(page, 'Settings');
    const cats = page.getByText('Categories', { exact: true }).first();
    if (await cats.count()) {
      await cats.scrollIntoViewIfNeeded();
      await cats.click();
      await page.waitForTimeout(700);
      await capture(page, 'categories');
    }
  } catch (e) {
    console.warn('⚠ categories skipped:', e.message.split('\n')[0]);
  }

  await browser.close();

  const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).sort();
  console.log(`\nDone — ${files.length} ${THEME} screenshots in ${OUT}`);
  for (const f of files) console.log(' ', f);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
