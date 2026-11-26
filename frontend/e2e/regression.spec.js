// Full UI regression against the real backend code with a fake AI (scripts/fake_ai_backend.py).
// Run: npm run test:e2e   (starts the fake backend and a Vite dev server itself)
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { PASSWORD, latestResetCode, register, sessionToken, sineWav, tempFile, uniqueEmail } from './helpers.js';

const ICS =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:inv-1\r\nSUMMARY:Sprint planning\r\n' +
  'DTSTART:20261120T100000Z\r\nDTEND:20261120T110000Z\r\nORGANIZER;CN=Bob Kumar:mailto:bob@example.com\r\n' +
  'ATTENDEE;CN=Carol;ROLE=REQ-PARTICIPANT:mailto:carol@example.com\r\n' +
  'ATTENDEE;CN=Dan;ROLE=OPT-PARTICIPANT:mailto:dan@example.com\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

test('organiser flow: register → record → review → approve → distribute', async ({ page, browser, baseURL }) => {
  const wav = tempFile('meeting.wav', sineWav(3));
  const tiny = tempFile('tiny.webm', Buffer.alloc(50, 1));
  const ics = tempFile('invite.ics', ICS);
  const email = uniqueEmail('priya');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const api = (p, token) => page.request.get(`${baseURL}/api${p}`, { headers: { Authorization: `Bearer ${token}` } });
  let token;
  let meetingId;

  await test.step('protected page redirects to login; validation; sign up signs in', async () => {
    await page.goto('/history');
    await page.waitForURL('**/login');
    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await expect(page.getByText('Name is required')).toBeVisible();
    await page.getByLabel('Your name').fill('Priya Sharma');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('different');
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await expect(page.getByText('Use at least 8 characters')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await page.waitForURL('**/history');
    token = await sessionToken(page);
    expect(token).toMatch(/^mom_/);
  });

  await test.step('duplicate email is rejected with a sign-in hint', async () => {
    const ctx = await browser.newContext();
    const p2 = await ctx.newPage();
    await p2.goto(`${baseURL}/login`);
    await p2.getByRole('tab', { name: 'Create account' }).click();
    await p2.getByLabel('Your name').fill('X');
    await p2.getByLabel('Email').fill(email);
    await p2.getByLabel('Password', { exact: true }).fill('another password');
    await p2.getByLabel('Confirm password').fill('another password');
    await p2.getByRole('button', { name: 'Create account' }).last().click();
    await expect(p2.getByText(/already has an account/)).toBeVisible();
    await ctx.close();
  });

  await test.step('settings: Outlook unavailable without MS_CLIENT_ID', async () => {
    await page.goto('/settings');
    await expect(page.getByText(/no Microsoft app configured/)).toBeVisible();
  });

  await test.step('new meeting: validation, consent required, owner auto-added', async () => {
    await page.goto('/meetings/new');
    await page.getByRole('button', { name: 'Continue to recording' }).click();
    await expect(page.getByText('Meeting title is required')).toBeVisible();
    await expect(page.getByText(/Confirm that everyone has been told/)).toBeVisible();
    await page.getByLabel('Meeting title').fill('Launch sync');
    await page.getByRole('button', { name: '+ Add participant' }).click();
    await page.getByLabel('Participant 1 name').fill('Tom Lee');
    await page.getByLabel('Participant 1 email').fill('tom@example.com');
    await page.getByRole('button', { name: '+ Add participant' }).click();
    await page.getByLabel('Participant 2 name').fill('Sam');
    await page.getByLabel('Participant 2 email').fill('bounce.sam@example.com');
    await page.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Continue to recording' }).click();
    await page.waitForURL(/\/meetings\/\d+\/record$/);
    meetingId = page.url().match(/meetings\/(\d+)/)[1];
    await expect(page.getByText('Priya Sharma').first()).toBeVisible();
  });

  await test.step('microphone is captured and sliced into chunks', async () => {
    await page.getByRole('button', { name: 'Start microphone' }).click();
    await page.getByText('● Capturing').first().waitFor();
    await expect.poll(() => page.getByRole('cell', { name: 'Microphone' }).count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  });

  await test.step('meeting audio share, pause and resume', async () => {
    await page.getByRole('button', { name: 'Share meeting audio' }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: '❚❚ Pause' }).first().click();
    await expect(page.getByText(/PAUSED/).first()).toBeVisible();
    await page.getByRole('button', { name: '▶ Resume' }).first().click();
  });

  await test.step('fallback: upload a recording file', async () => {
    await page.getByText('Upload a recording instead').click();
    await page.getByTestId('recording-file').setInputFiles(wav);
    await page.getByRole('cell', { name: 'Meeting audio' }).first().waitFor();
  });

  await test.step('leaving while recording is guarded', async () => {
    await page.getByRole('link', { name: /History/ }).click();
    await expect(page.getByText('Leave while recording?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  await test.step('end → all chunks on server → processing → review', async () => {
    await page.getByRole('button', { name: '■ End & generate MOM' }).click();
    await page.getByRole('button', { name: 'End & generate MOM', exact: true }).click();
    await page.waitForURL('**/processing', { timeout: 30_000 });
    const chunks = await (await api(`/meetings/${meetingId}/chunks`, token)).json();
    expect(chunks.some((c) => c.track === 'mic')).toBe(true);
    expect(chunks.some((c) => c.track === 'meeting')).toBe(true);
    await page.waitForURL('**/review', { timeout: 90_000 });
  });

  await test.step('review: approval blocked until speakers named and owners set', async () => {
    await page.locator('summary', { hasText: 'Transcript' }).click();
    await expect(page.getByText(/Qa found two blockers/i).first()).toBeVisible();
    await page.getByRole('button', { name: 'Approve MOM' }).click();
    await expect(page.getByText('Who is this? Enter their name')).toBeVisible();
    await expect(page.getByText('Owner is required').first()).toBeVisible();
    const n = await page.locator('input[aria-label$=" name"]').count();
    for (let i = 1; i <= n; i++) {
      const field = page.getByLabel(`Participant ${i} name`);
      if (/^speaker/i.test(await field.inputValue())) await field.fill('Sam Patel');
    }
    await page.getByLabel('Owner 1').selectOption('Priya Sharma');
    await page.getByLabel('Owner 2').selectOption('Tom Lee');
    await page.getByLabel('Deadline 2').fill('2026-11-27');
    await page.getByRole('button', { name: 'Approve MOM' }).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForURL('**/distribute');
  });

  await test.step('distribute: failed recipient is reported', async () => {
    await page.getByRole('button', { name: 'Send MOM' }).click();
    await page.getByRole('button', { name: 'Send now' }).click();
    await expect(page.getByText('SMTP refused recipient')).toBeVisible();
  });

  await test.step('transcript TXT download', async () => {
    await page.getByRole('link', { name: 'View MOM' }).click();
    await page.locator('summary', { hasText: 'Transcript' }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ TXT' }).click()]);
    expect(fs.readFileSync(await dl.path(), 'utf8')).toMatch(/blockers/i);
  });

  await test.step('meeting from .ics invite', async () => {
    await page.goto('/meetings/new');
    await page.getByRole('tab', { name: /Invite file/ }).click();
    await page.locator('input[type=file]').setInputFiles(ics);
    await page.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Continue to recording' }).click();
    await page.waitForURL(/record$/);
    await expect(page.getByRole('heading', { name: 'Sprint planning' })).toBeVisible();
    await expect(page.getByText('Participants (4)')).toBeVisible();
  });

  await test.step('unreadable chunk → failed → retry without it is offered', async () => {
    await page.getByText('Upload a recording instead').click();
    await page.getByTestId('recording-file').setInputFiles(tiny);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: '■ End & generate MOM' }).click();
    await page.getByRole('button', { name: 'End & generate MOM', exact: true }).click();
    await page.waitForURL('**/processing');
    await expect(page.getByText(/Processing failed/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Retry without the 1 unreadable/ })).toBeVisible();
  });

  await test.step('discard deletes a meeting', async () => {
    await page.goto('/meetings/new');
    await page.getByLabel('Meeting title').fill('Throwaway');
    await page.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Continue to recording' }).click();
    await page.waitForURL(/record$/);
    await page.getByRole('button', { name: /Discard meeting/ }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await page.waitForURL((u) => u.pathname === '/');
    await expect(page.getByText('In progress')).toBeVisible();
  });

  await test.step('log out; wrong password rejected; sign in with password', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.waitForURL('**/login');
    expect((await api('/users/me', token)).status()).toBe(401); // logout ended the session on the server
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrong password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/Email or password is incorrect/)).toBeVisible();
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => u.pathname === '/');
    token = await sessionToken(page);
  });

  await test.step('forgot password: emailed code sets a new password and signs in', async () => {
    const ctx = await browser.newContext();
    const p4 = await ctx.newPage();
    await p4.goto(`${baseURL}/login`);
    await p4.getByRole('link', { name: 'Forgot password?' }).click();
    await p4.getByLabel('Email').fill(email);
    await p4.getByRole('button', { name: 'Send code' }).click();
    await expect(p4.getByText(/6-digit code is on its way/)).toBeVisible();
    await p4.getByLabel('6-digit code').fill('000000');
    await p4.getByLabel('New password', { exact: true }).fill('brand new password');
    await p4.getByLabel('Confirm new password').fill('brand new password');
    await p4.getByRole('button', { name: /Set new password/ }).click();
    await expect(p4.getByText(/wrong or has expired/)).toBeVisible();
    await expect.poll(() => latestResetCode(email)).not.toBeNull();
    await p4.getByLabel('6-digit code').fill(latestResetCode(email));
    await p4.getByRole('button', { name: /Set new password/ }).click();
    await p4.waitForURL((u) => u.pathname === '/');
    await ctx.close();
    // Resetting the password signed out every other session, including the first browser.
    expect((await api('/users/me', token)).status()).toBe(401);
    await page.goto('/history');
    await page.waitForURL('**/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('brand new password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  });

  await test.step('settings: change password; API token is optional', async () => {
    await page.goto('/settings');
    await page.getByLabel('Current password').fill('brand new password');
    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm new password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Change password' }).last().click();
    await expect(page.getByText(/Password changed/)).toBeVisible();
    await page.getByRole('button', { name: 'Get a new token' }).click();
    await page.getByRole('button', { name: 'Get new token' }).click();
    await expect(page.getByText(/won't be shown again/)).toBeVisible();
    await page.goto('/history');
    await expect(page.getByRole('link', { name: 'Launch sync' })).toBeVisible();
    token = await sessionToken(page);
  });

  await test.step("another user can't open this meeting", async () => {
    const ctx = await browser.newContext();
    const p3 = await ctx.newPage();
    await p3.goto(`${baseURL}/login`);
    await register(p3, 'Eve', uniqueEmail('eve'));
    await p3.goto(`${baseURL}/meetings/${meetingId}`);
    await expect(p3.getByText('Meeting not found')).toBeVisible();
    await ctx.close();
  });

  await test.step('mobile layout has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const p of ['/', '/meetings/new', '/settings', `/meetings/${meetingId}`]) {
      await page.goto(p);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `overflow on ${p}`).toBeLessThanOrEqual(0);
    }
  });

  expect(errors).toEqual([]);
});
