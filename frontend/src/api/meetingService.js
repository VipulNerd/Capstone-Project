import client from './client';
import config from '../config';
import * as mock from './mockServer';

/**
 * Upload a recording or transcript.
 * @param {{ title, date, participants, sourceType, file?, transcriptText? }} input
 * @param {(percent:number)=>void} onProgress
 */
export async function uploadMeeting(input, onProgress) {
  const { file, transcriptText, ...metadata } = input;
  const formData = new FormData();
  formData.append('metadata', JSON.stringify(metadata));
  if (file) {
    formData.append('file', file);
  } else if (transcriptText) {
    formData.append('file', new Blob([transcriptText], { type: 'text/plain' }), 'pasted-transcript.txt');
  }

  if (config.USE_MOCK) return mock.uploadMeeting(formData, onProgress);
  const { data } = await client.post('/meetings', formData, {
    onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded * 100) / e.total)),
  });
  return data; // { id, status }
}

export async function listMeetings() {
  if (config.USE_MOCK) return mock.listMeetings();
  const { data } = await client.get('/meetings');
  return data;
}

export async function getMeeting(id) {
  if (config.USE_MOCK) return mock.getMeeting(id);
  const { data } = await client.get(`/meetings/${id}`);
  return data;
}

export async function getMeetingStatus(id) {
  if (config.USE_MOCK) return mock.getMeetingStatus(id);
  const { data } = await client.get(`/meetings/${id}`);
  return data;
}
