import client, { saveBlob } from './client';
import { fromApiChunk, fromApiMeeting, fromApiSummary, toApiParticipants } from './mappers';

// --- Starting a recording session ---

/**
 * POST /meetings. Either a calendar event (participants come from the invite)
 * or a title + participants typed in by the user. Consent is mandatory.
 */
export async function startMeeting({ calendarEventId, calendarProvider, title, participants = [] }) {
  const body = { recording_consent: true };
  if (calendarEventId) Object.assign(body, { calendar_event_id: calendarEventId, calendar_provider: calendarProvider });
  else Object.assign(body, { title: title.trim(), participants: toApiParticipants(participants) });
  const { data } = await client.post('/meetings', body);
  return fromApiMeeting(data);
}

/** POST /meetings/from-ics: title, time and participants from an invite file. */
export async function startMeetingFromIcs(file) {
  const form = new FormData();
  form.append('invite', file);
  form.append('recording_consent', 'true');
  const { data } = await client.post('/meetings/from-ics', form);
  return fromApiMeeting(data);
}

// --- Audio ---

/**
 * Uploads one audio slice. Idempotent per (track, seq), so retrying is safe.
 * @param {{ track: 'mic'|'meeting', seq: number, offsetMs: number, blob: Blob, filename: string }} chunk
 */
export async function uploadChunk(meetingId, { track, seq, offsetMs, blob, filename }, onProgress) {
  const form = new FormData();
  form.append('track', track);
  form.append('seq', String(seq));
  form.append('offset_ms', String(Math.max(0, Math.round(offsetMs))));
  form.append('file', blob, filename);
  const { data } = await client.post(`/meetings/${meetingId}/audio`, form, {
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded * 100) / e.total)),
  });
  return fromApiChunk(data);
}

/** What the server has received (to find gaps before ending). */
export async function listChunks(meetingId) {
  const { data } = await client.get(`/meetings/${meetingId}/chunks`);
  return data.map(fromApiChunk);
}

/** Stops recording and starts finalisation (status -> finalizing). */
export async function endMeeting(meetingId) {
  const { data } = await client.post(`/meetings/${meetingId}/end`);
  return fromApiMeeting(data);
}

/** Resumes a failed finalisation; already-transcribed chunks are not re-sent. */
export async function retryMeeting(meetingId, skipFailedChunks = false) {
  const { data } = await client.post(`/meetings/${meetingId}/retry`, { skip_failed_chunks: skipFailedChunks });
  return fromApiMeeting(data);
}

// --- Transcript ---

/** Refined, speaker-labelled transcript: [{ t (seconds), speaker, text }]. 409 until ready. */
export async function getTranscript(meetingId) {
  const { data } = await client.get(`/meetings/${meetingId}/transcript`, { params: { format: 'json' } });
  return data.lines || [];
}

export async function downloadTranscript(meetingId, format, fileBaseName) {
  const { data } = await client.get(`/meetings/${meetingId}/transcript`, { params: { format }, responseType: 'blob' });
  saveBlob(data, `${fileBaseName}.${format}`);
}

// --- Meetings ---

export async function listMeetings() {
  const { data } = await client.get('/meetings');
  return data.map(fromApiSummary);
}

export async function getMeeting(id) {
  const { data } = await client.get(`/meetings/${id}`);
  return fromApiMeeting(data);
}

/** Also deletes stored audio. 409 while finalising. */
export async function deleteMeeting(id) {
  await client.delete(`/meetings/${id}`);
}

export async function getHealth() {
  const { data } = await client.get('/health', { timeout: 5000 });
  return data; // { status: 'ok' | 'degraded', database: boolean }
}
