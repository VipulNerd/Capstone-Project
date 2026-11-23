import client from './client';

// Not implemented by the backend yet: only used when VITE_FEATURE_SEARCH=true.

export async function semanticSearch(query) {
  const { data } = await client.get('/search', { params: { q: query } });
  return data; // [{ meetingId, title, date, score, snippet }]
}
