import client from './client';
import { fromApiEvent, utc } from './mappers';

// Outlook calendar via Microsoft Graph. When the server has no MS_CLIENT_ID these return 503.

/** Microsoft's consent page URL; open it in a new tab. */
export async function getMicrosoftConnectUrl() {
  const { data } = await client.get('/calendar/microsoft/connect');
  return data.authorization_url;
}

/** False when the server has no Microsoft app configured (connect returns 503). No side effects. */
export async function isMicrosoftConfigured() {
  try {
    await getMicrosoftConnectUrl();
    return true;
  } catch (err) {
    if (err.status === 503) return false;
    throw err;
  }
}

export async function listConnections() {
  const { data } = await client.get('/calendar/connections');
  return data.map((c) => ({ provider: c.provider, accountEmail: c.account_email, connectedAt: utc(c.connected_at) }));
}

export async function disconnectCalendar(provider = 'microsoft') {
  await client.delete(`/calendar/connections/${provider}`);
}

/** Meetings from 2 h ago to 12 h ahead (server default). 409 = not connected. */
export async function listEvents() {
  const { data } = await client.get('/calendar/events');
  return data.map(fromApiEvent);
}
