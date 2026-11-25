import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = [
  ['/', 'Beyond a stay'],
  ['/hotels', 'Our hotels'],
  ['/rooms', 'Rooms and suites'],
  ['/facilities', 'Facilities'],
  ['/dining', 'Dining'],
  ['/gallery', 'Hotel gallery'],
  ['/offers', 'Offers']
];
const roles = [
  ['super-admin', 'Central command center', 'Audit trail'],
  ['branch-manager', 'Branch management', 'Offers'],
  ['receptionist', 'Front desk', 'Front desk'],
  ['housekeeping', 'Housekeeping', 'Housekeeping'],
  ['maintenance', 'Maintenance', 'Maintenance'],
  ['finance', 'Finance', 'Billing'],
  ['guest', 'Guest portal', 'My reservations']
];

async function audit(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map(({ id, nodes }) => ({ id, elements: nodes.map(({ target }) => target) }))).toEqual([]);
}

test('public pages work at mobile width and have no detected axe A/AA violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [route, heading] of pages) {
    await page.goto(route);
    await expect(page.locator('main h1')).toContainText(new RegExp(heading.replace(' and ', ' (?:and|&) '), 'i'));
    expect(await page.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await audit(page);
  }
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

for (const [role, heading, control] of roles) {
  test(role + ' has an authorized landing screen on mobile', async ({ page }) => {
    const guest = role === 'guest';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(guest ? '/login' : '/staff/login');
    await page.getByLabel('Email').fill(role + '@demo.luxurystay.test');
    await page.getByLabel('Password', { exact: true }).fill(process.env.BROWSER_TEST_DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    if (guest) await page.getByRole('link', { name: 'My account' }).click();
    await expect(page.locator('main h1')).toHaveText(heading);
    await expect(page.getByRole(guest ? 'heading' : 'button', { name: control, exact: true })).toBeVisible();
    expect(await page.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const response = await page.request.get('/api/staff/command');
    expect(response.status()).toBe(['super-admin', 'branch-manager', 'finance'].includes(role) ? 200 : 403);
    if (role === 'super-admin') await expect(page.getByRole('heading', { name: 'Portfolio totals' })).toBeVisible();
    if (['branch-manager', 'finance'].includes(role)) {
      expect((await response.json()).portfolio).toBeUndefined();
      await expect(page.getByRole('heading', { name: 'Portfolio totals' })).toHaveCount(0);
    }
    await audit(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole(guest ? 'heading' : 'button', { name: control, exact: true })).toBeVisible();
    expect(await page.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  });
}
