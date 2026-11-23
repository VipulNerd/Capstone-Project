import client, { saveBlob } from './client';
import { fromApiMeeting, toApiMom } from './mappers';

/** Saves organiser edits to a draft. Returns the updated meeting. */
export async function updateMom(meetingId, draft) {
  const { data } = await client.put(`/meetings/${meetingId}/mom`, toApiMom(draft));
  return fromApiMeeting(data);
}

/** Locks the MOM. Only approved MOMs can be distributed. */
export async function approveMom(meetingId, approvedBy) {
  const { data } = await client.post(`/meetings/${meetingId}/approve`, { approved_by: approvedBy });
  return fromApiMeeting(data);
}

/** Withdraws approval so the draft can be edited again (only before distribution). */
export async function reopenMom(meetingId) {
  const { data } = await client.post(`/meetings/${meetingId}/reopen`);
  return fromApiMeeting(data);
}

/** Downloads the MOM as PDF or DOCX. */
export async function exportMom(meetingId, format, fileBaseName = `MOM-${meetingId}`) {
  const { data } = await client.get(`/meetings/${meetingId}/export`, { params: { format }, responseType: 'blob' });
  saveBlob(data, `${fileBaseName}.${format}`);
}
