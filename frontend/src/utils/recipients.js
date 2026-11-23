import { isEmail } from './validators';

/**
 * The unique addresses POST /meetings/{id}/distribute will email:
 * every participant with an email, plus the organiser (same de-dupe as the backend).
 */
export function recipientEmails(participants, organizerEmail) {
  const all = [...participants.map((p) => p.email), organizerEmail]
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => isEmail(e));
  return [...new Set(all)];
}
