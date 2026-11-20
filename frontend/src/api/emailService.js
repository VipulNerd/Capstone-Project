import client from './client';
import config from '../config';
import * as mock from './mockServer';

export async function sendMom(meetingId, formats) {
  if (config.USE_MOCK) return mock.sendMom(meetingId, formats);
  const { data } = await client.post(`/meetings/${meetingId}/send`, { formats });
  return data;
}

export async function getDeliveries(meetingId) {
  if (config.USE_MOCK) return mock.getDeliveries(meetingId);
  const { data } = await client.get(`/meetings/${meetingId}/deliveries`);
  return data;
}

export async function retryDelivery(meetingId, email) {
  if (config.USE_MOCK) return mock.retryDelivery(meetingId, email);
  const { data } = await client.post(`/meetings/${meetingId}/deliveries/retry`, { email });
  return data;
}
