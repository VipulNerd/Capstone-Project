// The backend speaks snake_case and uses null for "not set"; the UI uses camelCase
// and empty strings (so inputs stay controlled). All translation happens here.

/**
 * Backend datetimes are UTC, but some databases (SQLite) return them without an offset,
 * which browsers would parse as local time. Mark offset-less values as UTC.
 */
export const utc = (v) => (v && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? `${v}Z` : v || null);

export function fromApiSummary(m) {
  return {
    id: m.id,
    title: m.title,
    date: m.meeting_date || '',
    organizerName: m.organizer_name,
    status: m.status,
    createdAt: utc(m.created_at),
  };
}

export function fromApiParticipant(p) {
  return {
    name: p.name,
    email: p.email || '',
    source: p.source || 'manual', // 'calendar' | 'manual' | 'detected'
    optional: !!p.is_optional,
  };
}

export function fromApiMeeting(m) {
  return {
    ...fromApiSummary(m),
    organizerEmail: m.organizer_email,
    calendarSource: m.calendar_source, // 'microsoft' | 'ics' | 'manual'
    scheduledStart: utc(m.scheduled_start),
    scheduledEnd: utc(m.scheduled_end),
    joinUrl: m.join_url,
    recordingStartedAt: utc(m.recording_started_at),
    recordingEndedAt: utc(m.recording_ended_at),
    errorMessage: m.error_message,
    hasTranscript: !!m.has_transcript,
    summary: m.summary || '',
    discussionPoints: m.discussion_points || [],
    decisions: m.decisions || [],
    participants: (m.participants || []).map(fromApiParticipant),
    actionItems: (m.action_items || []).map((a) => ({
      id: a.id,
      task: a.task,
      owner: a.owner || '',
      deadline: a.deadline || '',
    })),
    approvedBy: m.approved_by,
    approvedAt: utc(m.approved_at),
    updatedAt: utc(m.updated_at),
  };
}

const blankToNull = (v) => (v && String(v).trim() ? String(v).trim() : null);

/** Participants for POST /meetings and PUT /mom. */
export const toApiParticipants = (people) =>
  people.map((p) => ({ name: p.name.trim(), email: blankToNull(p.email) }));

/** Body for PUT /meetings/{id}/mom. Lists replace the stored lists. */
export function toApiMom(draft) {
  return {
    title: draft.title.trim(),
    meeting_date: blankToNull(draft.date),
    summary: draft.summary,
    discussion_points: draft.discussionPoints.map((d) => d.trim()).filter(Boolean),
    decisions: draft.decisions.map((d) => d.trim()).filter(Boolean),
    participants: toApiParticipants(draft.participants),
    action_items: draft.actionItems.map((a) => ({
      task: a.task.trim(),
      owner: blankToNull(a.owner),
      deadline: blankToNull(a.deadline),
    })),
  };
}

export function fromApiChunk(c) {
  return {
    track: c.track, // 'mic' | 'meeting'
    seq: c.seq,
    offsetMs: c.offset_ms,
    size: c.size_bytes,
    status: c.status, // 'pending' | 'transcribed' | 'failed'
    error: c.error,
    receivedAt: utc(c.received_at),
  };
}

export function fromApiEvent(e) {
  return {
    id: e.event_id,
    provider: e.provider || 'microsoft',
    title: e.title,
    start: utc(e.start),
    end: utc(e.end),
    organizerName: e.organizer_name,
    organizerEmail: e.organizer_email,
    attendees: e.attendees.map((a) => ({ name: a.name, email: a.email || '', optional: a.optional })),
    joinUrl: e.join_url,
  };
}

export function fromApiDelivery(d) {
  return {
    id: d.id,
    email: d.recipient_email,
    status: d.status, // 'sent' | 'failed'
    error: d.error,
    attemptedAt: utc(d.attempted_at),
  };
}
