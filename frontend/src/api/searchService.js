import client from './client';
import config from '../config';
import * as mock from './mockServer';

export async function semanticSearch(query) {
  if (config.USE_MOCK) return mock.search(query);
  const { data } = await client.get('/search', { params: { q: query } });
  return data; // [{ meetingId, title, date, score, snippet }]
}
