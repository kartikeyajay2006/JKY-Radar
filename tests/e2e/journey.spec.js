/** @import { Page } from '@playwright/test' */
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/** @param {string} p */
const fx = (p) => readFileSync(`fixtures/${p}`);
const email = `e2e-${Date.now()}@example.com`;

/**
 * @param {Page} page
 * @param {string} mail
 */
async function register(page, mail) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Erin Engineer');
  await page.getByLabel('Work email').fill(mail);
  await page.getByLabel('Password').fill('correct-horse-42');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
}

test.describe.serial('core journey', () => {
  /** @type {Page} */
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test('public landing runs the engine in the browser', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Know what breaks');
    await expect(page.getByText('Guaranteed response property removed').first()).toBeVisible();
    await page.getByRole('button', { name: 'Safe release' }).click();
    await expect(page.locator('text=Pass').first()).toBeVisible();
  });

  test('public demo is readable without signing in', async () => {
    await page.goto('/demo');
    await page.getByRole('link', { name: /ShopWave Commerce API/ }).click();
    await expect(page.getByText('Do not release: breaking changes found')).toBeVisible();
    await page.getByRole('tab', { name: 'Consumer impact' }).click();
    await expect(page.getByText('ShopWave iOS app').first()).toBeVisible();
  });

  test('register and create a project', async () => {
    await register(page, email);
    await page.getByRole('link', { name: 'View projects' }).click();
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('Checkout API');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/versions$/);
  });

  test('invalid uploads show line-level diagnostics', async () => {
    await page.locator('input[type=file]').setInputFiles({
      name: 'broken.yaml',
      mimeType: 'application/x-yaml',
      buffer: fx('adversarial/malformed.yaml'),
    });
    await page.getByLabel('Version label').fill('broken');
    await page.getByRole('button', { name: 'Save version' }).click();
    await expect(page.getByRole('alert').first()).toContainText('line');
  });

  test('upload baseline and candidate', async () => {
    for (const [file, label] of [
      ['openapi/breaking/ecommerce-v1.yaml', 'v1.4.0'],
      ['openapi/breaking/ecommerce-v2.yaml', 'v2.0.0'],
    ]) {
      await page
        .locator('input[type=file]')
        .setInputFiles({ name: file.split('/').pop(), mimeType: 'application/x-yaml', buffer: fx(file) });
      await page.getByLabel('Version label').fill(label);
      await page.getByRole('button', { name: 'Save version' }).click();
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }
  });

  test('run an analysis and see breaking findings', async () => {
    await page.getByRole('link', { name: 'Compare' }).click();
    await page.getByRole('button', { name: 'Run Radar analysis' }).click();
    await expect(page.getByText('Do not release: breaking changes found')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('listbox', { name: 'Findings' }).getByRole('option', { name: /Operation removed/ }),
    ).toBeVisible();
  });

  test('filter and search findings', async () => {
    await page.getByRole('button', { name: /^Breaking \d+/ }).click();
    await page.getByLabel('Search findings').fill('currency');
    const list = page.getByRole('listbox', { name: 'Findings' });
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option').first()).toContainText('New required request property');
    await page.getByRole('button', { name: 'Clear filters' }).click();
  });

  test('register a consumer and see its impact', async () => {
    const analysisUrl = page.url();
    await page.goto(analysisUrl.replace(/\/app\/analyses\/.*/, '/app'));
    await page.goBack();
    await page.getByRole('tab', { name: 'Consumer impact' }).click();
    await page.getByRole('link', { name: 'Register consumers' }).click();
    await page.getByRole('button', { name: 'Register consumer' }).click();
    await page.getByLabel('Application name').fill('Checkout web');
    await page.getByRole('button', { name: 'Save consumer' }).click();
    await page.getByLabel('Operation the consumer depends on').fill('GET /orders/{orderId}');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('GET /orders/{orderId}')).toBeVisible();
    await page.goto(`${analysisUrl.split('?')[0]}?tab=impact`);
    await expect(page.getByText('registered consumers directly affected')).toBeVisible();
    await expect(page.locator('table').getByText('Checkout web')).toBeVisible();
  });

  test('record a review decision', async () => {
    await page.getByRole('tab', { name: 'Reviews' }).click();
    await page
      .getByRole('textbox', { name: 'Rationale' })
      .fill('Keep the removed endpoint for one more release.');
    await page.getByRole('button', { name: 'Request changes' }).click();
    await expect(page.getByText('requested changes')).toBeVisible();
  });

  test('download a PDF report', async () => {
    await page.getByRole('button', { name: 'Export report' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /PDF report/ }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/^jky-radar_checkout-api_.+\.pdf$/);
  });
});
