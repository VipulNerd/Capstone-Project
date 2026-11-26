import client from './client';
import { fromApiEvent, utc } from './mappers';

// Google Calendar and Outlook (Microsoft Graph). A provider is usable only when the server has
// its OAuth app configured (GOOGLE_CLIENT_ID / MS_CLIENT_ID); GET /calendar/providers says which.

export const PROVIDER_LABELS = { google: 'Google Calendar', microsoft: 'Outlook' };

/** [{ provider: 'google' | 'microsoft', configured }] */
export async function listProviders() {
  const { data } = await client.get('/calendar/providers');
  return data;
}

/** The provider's consent page URL; open it in a new tab. */
export async function getConnectUrl(provider) {
  const { data } = await client.get(`/calendar/${provider}/connect`);
  return data.authorization_url;
}

export async function listConnections() {
  const { data } = await client.get('/calendar/connections');
  return data.map((c) => ({ provider: c.provider, accountEmail: c.account_email, connectedAt: utc(c.connected_at) }));
}

export async function disconnectCalendar(provider) {
  await client.delete(`/calendar/connections/${provider}`);
}

/** Meetings from 2 h ago to 12 h ahead from every connected calendar. 409 = none connected. */
export async function listEvents() {
  const { data } = await client.get('/calendar/events');
  return data.map(fromApiEvent);
}
