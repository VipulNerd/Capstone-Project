import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mom-e2e-'));

/** Writes a small file and returns its path. */
export function tempFile(name, content) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

/** A valid mono 16-bit WAV with a sine tone (the fake AI only checks it's > 200 bytes). */
export function sineWav(seconds = 3, rate = 16000) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

/** Unique per run so tests never clash with accounts from earlier runs. */
export const uniqueEmail = (name) => `${name}.${Date.now()}@example.com`;

/** Registers through the login page and returns the one-time API token. */
export async function register(page, name, email) {
  await page.goto('/login');
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Your email').fill(email);
  await page.getByRole('button', { name: 'Create account' }).last().click();
  await page.getByText('Save your API token').waitFor();
  const token = (await page.locator('code').textContent()).trim();
  await page.getByRole('button', { name: /saved it/ }).click();
  return token;
}

/** Fills the Review page so it passes validation: names unnamed speakers, owners, deadlines. */
export async function completeReview(page) {
  const names = page.locator('input[aria-label^="Participant "][aria-label$=" name"]');
  for (let i = 0; i < (await names.count()); i++) {
    const field = names.nth(i);
    if (/^speaker\s*\d+[a-z]?$/i.test((await field.inputValue()).trim())) await field.fill(`Guest ${i + 1}`);
  }
  const owners = page.locator('select[aria-label^="Owner "]');
  for (let i = 0; i < (await owners.count()); i++) {
    const owner = owners.nth(i);
    if (!(await owner.inputValue())) await owner.selectOption({ index: 1 });
  }
  const deadlines = page.locator('input[aria-label^="Deadline "]');
  const nextWeek = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  for (let i = 0; i < (await deadlines.count()); i++) {
    if (!(await deadlines.nth(i).inputValue())) await deadlines.nth(i).fill(nextWeek);
  }
}
