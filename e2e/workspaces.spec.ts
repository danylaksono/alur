import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

const sample = path.resolve('data_sample/need_london.parquet');

const loadSample = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByTitle('DuckDB engine ready')).toHaveText('Engine ready', { timeout: 45_000 });
  await page.locator('#alur-file-input').setInputFiles(sample);
  await expect(page.getByText(/need_london/i).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[aria-busy="false"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Loading data')).toBeHidden({ timeout: 45_000 });
};

const switchMode = async (page: Page, mode: 'explore' | 'compare' | 'explain') => {
  const button = page.getByRole('button', { name: new RegExp(`^${mode}$`, 'i') }).first();
  if (await button.isVisible()) { await button.focus(); await page.keyboard.press('Enter'); }
  else await page.locator('select[aria-label="Workspace mode"]').selectOption(mode);
};

const noOverlap = async (a: Locator, b: Locator) => {
  if (!await a.count() || !await b.count() || !await a.first().isVisible() || !await b.first().isVisible()) return;
  const [left, right] = await Promise.all([a.first().boundingBox(), b.first().boundingBox()]);
  if (!left || !right) return;
  const intersects = left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
  expect(intersects, `${await a.first().getAttribute('aria-label')} overlaps ${await b.first().getAttribute('aria-label')}`).toBe(false);
};

test('@a11y populated Explore, Compare, Explain, and inspector workflows', async ({ page }, testInfo) => {
  await loadSample(page);

  await test.step('Explore map chrome and selection inspector', async () => {
    const search = page.getByRole('search', { name: 'Search map locations' });
    const controls = page.getByLabel('Map controls');
    const legend = page.getByLabel('Map legends');
    await noOverlap(search, controls);
    await noOverlap(search, legend);
    await noOverlap(controls, legend);
    await page.screenshot({ path: testInfo.outputPath('explore.png'), fullPage: true });
    const results = await new AxeBuilder({ page }).exclude('.maplibregl-canvas').analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);

    await page.evaluate(() => {
      const store = (window as unknown as { __alurStore: { getState: () => { mapLayers: Array<{ id: string }>; setFeatureSelection: (id: string, values: string[]) => void } } }).__alurStore;
      const layerId = store.getState().mapLayers[0]?.id;
      if (layerId) store.getState().setFeatureSelection(layerId, ['1']);
    });
    await expect(page.getByText(/Selection —/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('selection-inspector.png'), fullPage: true });
    await page.getByRole('button', { name: 'Clear selection' }).click();
  });

  await test.step('two and four operand Compare', async () => {
    await switchMode(page, 'compare');
    await expect(page.getByRole('heading', { name: 'Comparison sessions' })).toBeVisible();
    await expect(page.getByText(/2 operands/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('compare-two-operands.png'), fullPage: true });
    await page.getByRole('button', { name: '+ Add' }).click();
    await page.getByRole('button', { name: '+ Add' }).click();
    await expect(page.getByText(/4 operands/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('compare-four-operands.png'), fullPage: true });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  });

  await test.step('Explain reasoning structure and presentation exit', async () => {
    await switchMode(page, 'explain');
    await expect(page.getByLabel('Section title').first()).toHaveValue('Question');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
    await page.getByRole('button', { name: 'Present' }).click();
    await expect(page.getByRole('button', { name: 'Exit presentation' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('explain.png'), fullPage: true });
  });
});
