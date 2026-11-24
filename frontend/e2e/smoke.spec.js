// Real-AI smoke test against a running system (local or Azure). Creates one account and one meeting.
//   E2E_BASE_URL=https://<frontend-fqdn> E2E_AUDIO=C:\path\two_speakers.m4a npm run test:smoke
//   (frontend and backend on different hosts: also set E2E_API_URL=https://<backend-fqdn>)
// E2E_AUDIO: a short real recording with 2+ voices (≤ 25 MB). Without it only the health and
// sign-up checks run.
import { expect, test } from '@playwright/test';
import { completeReview, register, uniqueEmail } from './helpers.js';

const AUDIO = process.env.E2E_AUDIO;

test.beforeAll(() => {
  if (!process.env.E2E_BASE_URL) throw new Error('Set E2E_BASE_URL, e.g. https://mom-frontend.<region>.azurecontainerapps.io');
});

test('backend and database are healthy', async ({ request, baseURL }) => {
  // Same-origin deployments proxy the API at /api. When the frontend calls the backend directly
  // (e.g. Static Web Apps + Container Apps), set E2E_API_URL to the backend's URL.
  const api = process.env.E2E_API_URL || `${baseURL}/api`;
  const res = await request.get(`${api.replace(/\/$/, '')}/health`);
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: 'ok', database: true });
});

test('real meeting: upload → AI transcript + MOM → approve → distribute', async ({ page }) => {
  await test.step('create account', async () => {
    await register(page, 'Smoke Tester', uniqueEmail('smoke'));
  });
  test.skip(!AUDIO, 'Set E2E_AUDIO to a real recording to run the AI part');

  await test.step('start a meeting', async () => {
    await page.goto('/meetings/new');
    await page.getByLabel('Meeting title').fill(`Smoke test ${new Date().toISOString().slice(0, 16)}`);
    await page.getByRole('button', { name: '+ Add participant' }).click();
    await page.getByLabel('Participant 1 name').fill('Alex Guest');
    await page.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Continue to recording' }).click();
    await page.waitForURL(/\/record$/);
  });

  await test.step('upload the recording and end', async () => {
    await page.getByText('Upload a recording instead').click();
    await page.getByTestId('recording-file').setInputFiles(AUDIO);
    await page.getByRole('cell', { name: 'Meeting audio' }).first().waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: '■ End & generate MOM' }).click();
    await page.getByRole('button', { name: 'End & generate MOM', exact: true }).click();
    await page.waitForURL('**/processing', { timeout: 120_000 });
  });

  await test.step('AI processing finishes (transcription, speakers, MOM)', async () => {
    const started = Date.now();
    const failed = page.getByText(/Processing failed/);
    await Promise.race([
      page.waitForURL('**/review', { timeout: 12 * 60_000 }),
      failed.waitFor({ timeout: 12 * 60_000 }).then(async () => {
        throw new Error(`Processing failed: ${await page.getByRole('alert').first().innerText()}`);
      }),
    ]);
    test.info().annotations.push({ type: 'processing seconds', description: String(Math.round((Date.now() - started) / 1000)) });
  });

  await test.step('transcript and MOM draft are filled in', async () => {
    await page.locator('summary', { hasText: 'Transcript' }).click();
    await expect(page.locator('details strong').first()).toBeVisible({ timeout: 30_000 });
    const speakers = [...new Set(await page.locator('details strong').allTextContents())];
    test.info().annotations.push({ type: 'speakers', description: speakers.join(', ') });
    await expect(page.getByLabel(/Summary/i).first()).not.toHaveValue('');
  });

  await test.step('approve and distribute', async () => {
    await completeReview(page);
    await page.getByRole('button', { name: 'Approve MOM' }).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForURL('**/distribute');
    await page.getByRole('button', { name: 'Send MOM' }).click();
    await page.getByRole('button', { name: 'Send now' }).click();
    await expect(page.getByRole('cell', { name: /sent|failed/i }).first()).toBeVisible({ timeout: 60_000 });
  });
});
