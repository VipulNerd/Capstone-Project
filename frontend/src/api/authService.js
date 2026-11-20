import client from './client';
import config from '../config';
import * as mock from './mockServer';

export async function login(email, password) {
  if (config.USE_MOCK) return mock.login(email, password);
  const { data } = await client.post('/auth/login', { email, password });
  return data; // { token, user }
}

export async function getCurrentUser() {
  if (config.USE_MOCK) return mock.me();
  const { data } = await client.get('/auth/me');
  return data;
}
