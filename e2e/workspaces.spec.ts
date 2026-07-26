import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import path from 'node:path';

const sample = path.resolve('data_sample/need_london.parquet');

const loadSample = async (page: Page) => {
  await page.goto('/');
  // The header only reports the engine while it is starting, so readiness is
  // read from the store rather than from a permanent status chip.
  await page.waitForFunction(
    () => (window as unknown as { __alurStore?: { getState: () => { duckdbReady: boolean } } }).__alurStore?.getState().duckdbReady === true,
    undefined,
    { timeout: 45_000 },
  );
  await page.locator('#alur-file-input').setInputFiles(sample);
  await expect(page.getByText(/need_london/i).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('[aria-busy="false"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Loading data')).toBeHidden({ timeout: 45_000 });
};

/** Every workspace is now one destination in the persistent left rail. */
const RAIL_DESTINATION = { explore: 'Layers', compare: 'Compare', explain: 'Report' } as const;

const switchMode = async (page: Page, mode: keyof typeof RAIL_DESTINATION) => {
  const rail = page.getByRole('navigation', { name: 'Primary' });
  await rail.getByRole('button', { name: RAIL_DESTINATION[mode], exact: true }).click();
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
    // Compare is a rail destination now — no landing page in between.
    await switchMode(page, 'compare');
    await expect(page.getByRole('heading', { name: 'Comparison sessions' })).toBeVisible();
    await expect(page.getByText('Spatial Intervention Loop')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('analyse-home.png'), fullPage: true });
    const analyseResults = await new AxeBuilder({ page }).analyze();
    expect(analyseResults.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
    await expect(page.getByText(/Comparing 2 groups/)).toBeVisible();
    await expect(page.getByText('Common scale · denominator shown').first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('compare-two-operands.png'), fullPage: true });
    if (testInfo.project.name === 'desktop') {
      await page.getByRole('tab', { name: 'Map', exact: true }).click();
      await expect(page.locator('div[aria-label$=" comparison map"]')).toHaveCount(2, { timeout: 30_000 });
      await expect(page.locator('[data-comparison-map-ready="true"]')).toHaveCount(2, { timeout: 30_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: testInfo.outputPath('compare-synchronised-maps.png'), fullPage: true });

      await page.getByText('Advanced comparison options', { exact: true }).click();
      await page.getByLabel('Comparison alignment').selectOption('entity-keyed');
      const rowId = await page.evaluate(() => Object.values((window as unknown as { __alurStore: { getState: () => { datasetRegistry: Record<string, { rowIdColumn: string }> } } }).__alurStore.getState().datasetRegistry)[0]?.rowIdColumn);
      const keySelectors = page.getByLabel(/entity key$/i);
      await keySelectors.nth(0).selectOption(rowId);
      await keySelectors.nth(1).selectOption(rowId);
      await page.getByLabel('Measure aggregation').selectOption('avg');
      await page.getByLabel(/measure field$/i).nth(0).selectOption('Gcons2023');
      await page.getByLabel(/measure field$/i).nth(1).selectOption('Gcons2023');
      await page.getByRole('tab', { name: 'Map', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Difference B − A' })).toBeEnabled({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Difference B − A' }).click();
      await expect(page.locator('[data-comparison-map-ready="true"]')).toHaveCount(1, { timeout: 30_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: testInfo.outputPath('compare-difference-map.png'), fullPage: true });
      await page.getByRole('button', { name: 'Pin to Explain' }).click();
      await expect(page.getByText(/frozen map evidence pinned/i)).toBeVisible();
      await page.getByRole('tab', { name: 'Records', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Entity-aligned record preview' })).toBeVisible({ timeout: 30_000 });
      await page.locator('tbody tr').first().click();
      await page.getByRole('button', { name: 'Use selected as filter' }).click();
      await expect(page.getByText(/explicitly as a dataset filter/i)).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('compare-aligned-records.png'), fullPage: true });
      await page.getByLabel('Comparison alignment').selectOption('aggregate-only');
    }
    await page.getByRole('button', { name: '+ Add' }).click();
    await page.getByRole('button', { name: '+ Add' }).click();
    await expect(page.getByText(/Comparing 4 groups/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('compare-four-operands.png'), fullPage: true });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  });

  await test.step('Explain reasoning structure and presentation exit', async () => {
    await switchMode(page, 'explain');
    await expect(page.getByLabel('Section title').first()).toHaveValue('Question');
    if (testInfo.project.name === 'mobile') {
      await page.getByRole('button', { name: 'Outline', exact: true }).click();
      await expect(page.locator('aside[aria-label="Explanation outline"]:visible')).toBeVisible();
      await page.getByRole('button', { name: 'Close outline' }).click();
    }
    if (testInfo.project.name === 'desktop') {
      await expect(page.locator('[data-comparison-map-ready="true"]')).toHaveCount(1, { timeout: 30_000 });
      await page.locator('article[aria-label$=" card"]').first().focus();
      const inspector = page.locator('aside[aria-label="Evidence inspector"]:visible');
      await expect(inspector).toBeVisible();
      await inspector.getByLabel('What this shows').fill('Energy consumption is spatially consistent across the two captured cohorts.');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await page.getByRole('button', { name: 'Add finding' }).click();
      await inspector.getByLabel('Claim').fill('The compared cohorts show no material spatial difference in this measure.');
      await inspector.getByLabel('Section').selectOption('conclusion');
      await inspector.locator('select').filter({ has: page.locator('option[value="supports"]') }).selectOption('supports');
      await page.screenshot({ path: testInfo.outputPath('explain-authoring.png'), fullPage: true });
    }
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exit presentation' })).toBeVisible();
    if (testInfo.project.name === 'desktop') await expect(page.locator('[data-comparison-map-ready="true"]')).toHaveCount(1, { timeout: 30_000 });
    await page.screenshot({ path: testInfo.outputPath('explain.png'), fullPage: true });
  });
});
