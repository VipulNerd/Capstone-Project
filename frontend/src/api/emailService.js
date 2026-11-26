import client from './client';
import { fromApiDelivery } from './mappers';

/**
 * Emails the approved MOM to every participant with an email address plus the organiser.
 * Sending is synchronous: the response already contains the per-recipient results.
 * Calling it again resends to everyone.
 */
export async function distributeMom(meetingId, format) {
  const { data } = await client.post(`/meetings/${meetingId}/distribute`, { format });
  return {
    sent: data.sent,
    failed: data.failed,
    deliveries: data.deliveries.map(fromApiDelivery),
    // 'console' = the server has no email account configured: nothing was actually emailed.
    emailMode: data.email_mode || 'smtp',
  };
}

/** Every delivery attempt for the meeting, oldest first. */
export async function getDeliveries(meetingId) {
  const { data } = await client.get(`/meetings/${meetingId}/deliveries`);
  return data.map(fromApiDelivery);
}
