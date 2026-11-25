import { expect, test } from '@playwright/test';

const password = process.env.BROWSER_TEST_DEMO_PASSWORD;
const propertyToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dubai' }).format(new Date());
function after(date, offset) {
  return new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0, 10);
}
async function signIn(page, role) {
  await page.getByLabel('Email').fill(role + '@demo.luxurystay.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  const [result] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/api/auth/') && response.url().endsWith('/login')),
    page.getByRole('button', { name: 'Sign in', exact: true }).click()
  ]);
  expect(result.status()).toBe(200);
}

test('guest booking survives authentication and reaches confirmed reservation history', async ({ page }) => {
  page.on('pageerror', (error) => console.error('Browser exception:', error.stack));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Beyond a stay/ })).toBeVisible();
  const headingFont = await page.getByRole('heading', { name: /Beyond a stay/ }).evaluate((element) => getComputedStyle(element).fontFamily);
  expect(headingFont).toContain('Playfair Display Variable');
  const bodyFont = await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily);
  expect(bodyFont).toContain('DM Sans Variable');
  const checkIn = after(propertyToday(), 10);
  const checkOut = after(propertyToday(), 12);
  await page.goto('/hotels/dubai/rooms/deluxe-king?checkIn=' + checkIn + '&checkOut=' + checkOut + '&guests=2');
  await page.getByRole('link', { name: 'Book now' }).first().click();
  await page.getByRole('link', { name: 'Guest sign-in to continue' }).click();
  await signIn(page, 'guest');
  await expect(page).toHaveURL(/\/book\/dubai\/deluxe-king/);
  await expect(page.locator('input[name=checkIn]')).toHaveValue(checkIn);
  await expect(page.locator('input[name=checkOut]')).toHaveValue(checkOut);
  await page.getByRole('button', { name: 'Place room hold' }).press('Enter');
  await page.getByRole('button', { name: 'Simulate payment & confirm' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Reservation confirmed' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Booking QR/ })).toBeVisible();
  await page.getByRole('link', { name: 'Back to my reservations' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'My reservations' })).toBeVisible();
  await expect(page.getByRole('link', { name: /View LS-/ })).toBeVisible();
  const view = page.getByRole('combobox', { name: 'Reservation history' });
  await view.focus();
  await view.press('End');
  await expect(page.getByRole('status').filter({ hasText: 'No stays match this view.' })).toBeVisible();
  await view.press('ArrowUp');
  await expect(page.getByRole('link', { name: /View LS-/ })).toBeVisible();

});

test('front desk checkout issues an invoice and finance settles the remaining balance', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const desk = await context.newPage();
  try {
    await desk.goto('/staff/login');
    await signIn(desk, 'branch-manager');
    await desk.getByText('Create a staff or walk-in reservation', { exact: true }).click();
    await desk.getByLabel('Guest name', { exact: true }).fill('Browser Test Guest');
    await desk.getByLabel('Guest email', { exact: true }).fill('guest@demo.luxurystay.test');
    await desk.locator('form:has(select[name=source]) select[name=type]').selectOption('deluxe-king');
    const today = propertyToday();
    await desk.getByLabel('Check-in', { exact: true }).fill(today);
    await desk.getByLabel('Check-out', { exact: true }).fill(after(today, 1));
    await desk.getByRole('button', { name: 'Create reservation', exact: true }).click();
    const queueFilter = desk.getByRole('searchbox', { name: 'Filter this queue by guest name or email' });
    await queueFilter.fill('no-matching-guest');
    await expect(desk.getByText('0 reservations match this queue.')).toBeVisible();
    await queueFilter.fill('browser test guest');
    await expect(desk.getByRole('row').filter({ hasText: 'Browser Test Guest' })).toBeVisible();
    await desk.getByRole('button', { name: 'Verify guest' }).click();
    await desk.getByRole('button', { name: 'Check in', exact: true }).click();
    await desk.getByText('Add a billing entry', { exact: true }).click();
    await desk.locator('select[name=kind]').first().selectOption('restaurant');
    await desk.locator('.ops-detail input[name=label]').fill('Dinner');
    await desk.getByLabel('Amount (AED)', { exact: true }).fill('25');
    await desk.getByRole('button', { name: 'Record entry' }).click();
    await expect(desk.getByText(/Dinner.*25/)).toBeVisible();
    await desk.getByRole('button', { name: 'Check out & issue invoice' }).click();
    await expect(desk.getByRole('link', { name: 'Download PDF invoice' })).toBeVisible();
    const reference = await desk.locator('.ops-detail h3').first().textContent();
    const financeContext = await browser.newContext({ baseURL });
    try {
      const finance = await financeContext.newPage();
      await finance.goto('/staff/login');
      await signIn(finance, 'finance');
      await finance.getByLabel('Booking reference or scanned QR').fill(reference);
      await finance.getByRole('button', { name: 'Find reservation' }).click();
      const invoice = finance.locator('.ops-detail').filter({ has: finance.getByRole('heading', { name: reference, exact: true }) });
      await expect(invoice).toContainText(/Outstanding\s+AED\s+25\.00/);
      await invoice.getByLabel('Amount (AED)', { exact: true }).fill('25');
      await finance.getByRole('button', { name: 'Record simulated transaction' }).click();
      await expect(finance.getByText('Simulated transaction recorded.')).toBeVisible();
      await expect(invoice).toContainText(/Outstanding\s+AED\s+0\.00/);
      const reconciliation = finance.getByRole('button', { name: 'Reconciliation', exact: true });
      await reconciliation.focus();
      await finance.keyboard.press('Enter');
      await expect(finance.getByRole('heading', { name: 'Invoice reconciliation' })).toBeVisible();
      await expect(finance.getByText('Revenue recognized at invoice issue, excluding tax')).toBeVisible();
      await expect(finance.getByRole('link', { name: 'Download accounting exceptions CSV' })).toBeVisible();
      await expect(finance.getByRole('table', { name: 'Invoices and closing balances' }).getByText(reference, { exact: true })).toBeVisible();
      const download = finance.getByRole('link', { name: 'Download settlement ledger CSV' });
      await download.focus();
      const [file] = await Promise.all([finance.waitForEvent('download'), finance.keyboard.press('Enter')]);
      await finance.setViewportSize({ width: 390, height: 844 });
      await expect(download).toBeVisible();
      expect(await finance.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      expect(file.suggestedFilename()).toMatch(/^luxurystay-settlements-.*\.csv$/);

    } finally {
      await financeContext.close();
    }
    await desk.getByRole('button', { name: 'Digital Twin', exact: true }).click();
    await expect(desk.locator('.floor-plan .state-dirty')).toHaveCount(1);
    const tile = desk.getByRole('button', { name: /dirty$/i });
    await tile.focus();
    await desk.keyboard.press('Enter');
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await expect(desk.getByRole('heading', { name: 'Room readiness estimate' })).toBeVisible();

    const receptionContext = await browser.newContext({ baseURL });
    try {
      const reception = await receptionContext.newPage();
      await reception.goto('/staff/login');
      await signIn(reception, 'receptionist');
      await reception.getByRole('button', { name: 'Housekeeping', exact: true }).click();
      await reception.getByLabel('Cleaning queue').selectOption('pending');
      await expect(reception.getByText('1 cleaning tasks in this queue.')).toBeVisible();
      await expect(reception.getByRole('button', { name: 'Start cleaning' })).toHaveCount(0);
      const branches = await (await reception.request.get('/api/staff/branches')).json();
      const branch = branches.branches.find((item) => item.slug === 'dubai');
      const endpoint = '/api/staff/properties/' + branch._id + '/cleaning';
      const { tasks } = await (await reception.request.get(endpoint)).json();
      expect((await reception.request.post(endpoint + '/' + tasks[0]._id, { data: { action: 'start' } })).status()).toBe(403);
    } finally {
      await receptionContext.close();
    }

  } finally {
    await context.close();
  }
});

test('mobile guest can book a manager-published package with reduced motion', async ({ page, playwright, baseURL }) => {
  const setup = await playwright.request.newContext({ baseURL });
  try {
    const session = await setup.post('/api/auth/staff/login', { data: {
      email: 'branch-manager@demo.luxurystay.test', password
    } });
    expect(session.ok()).toBeTruthy();
    const { branches } = await (await setup.get('/api/staff/branches')).json();
    const dubai = branches.find((item) => item.slug === 'dubai');
    const { roomTypes } = await (await setup.get('/api/branches/dubai/room-types')).json();
    const type = roomTypes.find((item) => item.slug === 'deluxe-king');
    const today = propertyToday();
    const start = after(today, 20);
    const end = after(today, 22);
    const published = await setup.post('/api/staff/properties/' + dubai._id + '/offers', { data: {
      title: 'Breakfast on the Terrace', description: 'Two nights with breakfast included for your stay.',
      type: type._id, services: ['Breakfast'], restrictions: '', bookStart: today, bookEnd: after(today, 1),
      stayStart: start, stayEnd: after(today, 30), minimumNights: 2, maxUses: 5, discountBps: 2500, published: true
    } });
    expect(published.status()).toBe(201);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/offers');
    await expect(page.getByRole('heading', { name: 'Breakfast on the Terrace' })).toBeVisible();
    expect(await page.locator('body').evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const offerLink = page.getByRole('link', { name: 'Check package availability' });
    await offerLink.focus();
    await expect(offerLink).toBeFocused();
    await offerLink.press('Enter');
    await page.locator('input[name=checkIn]').fill(start);
    await page.locator('input[name=checkOut]').fill(end);
    await page.getByRole('button', { name: 'Check availability' }).click();
    await expect(page.getByText('AED 1,440.00')).toBeVisible();
    await page.getByRole('link', { name: 'Guest sign-in to continue' }).click();
    await signIn(page, 'guest');
    await page.getByRole('button', { name: 'Place room hold' }).click();
    await page.getByRole('button', { name: 'Simulate payment & confirm' }).click();
    await expect(page.getByRole('heading', { name: 'Reservation confirmed' })).toBeVisible();
    await expect(page.getByText('Package: Breakfast on the Terrace · Breakfast')).toBeVisible();
  } finally {
    await setup.dispose();
  }
});
