import client from './client';
import config from '../config';
import * as mock from './mockServer';

export async function getMom(meetingId) {
  if (config.USE_MOCK) return mock.getMom(meetingId);
  const { data } = await client.get(`/meetings/${meetingId}/mom`);
  return data;
}

export async function updateMom(meetingId, mom) {
  if (config.USE_MOCK) return mock.updateMom(meetingId, mom);
  const { data } = await client.put(`/meetings/${meetingId}/mom`, mom);
  return data;
}

export async function approveMom(meetingId) {
  if (config.USE_MOCK) return mock.approveMom(meetingId);
  const { data } = await client.post(`/meetings/${meetingId}/approve`);
  return data;
}

/** Downloads the MOM as PDF or DOCX and triggers a browser save. */
export async function exportMom(meetingId, format, fileBaseName = `MOM-${meetingId}`) {
  let blob;
  if (config.USE_MOCK) {
    blob = await mock.exportMom(meetingId, format);
  } else {
    const { data } = await client.get(`/meetings/${meetingId}/export`, {
      params: { format },
      responseType: 'blob',
    });
    blob = data;
  }
  const ext = config.USE_MOCK ? `${format}.txt` : format;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBaseName}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
