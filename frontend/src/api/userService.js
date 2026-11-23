import client from './client';

/** POST /users. The API token is returned only this once. */
export async function register(name, email) {
  const { data } = await client.post('/users', { name, email });
  return { user: { id: data.id, name: data.name, email: data.email }, token: data.api_token };
}

/** Checks a token (e.g. pasted on the sign-in screen) without touching the stored one. */
export async function getMe(token) {
  const { data } = await client.get('/users/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    skipAuthRedirect: !!token,
  });
  return data; // { id, name, email }
}

/** Issues a new token; the old one stops working immediately. */
export async function rotateToken() {
  const { data } = await client.post('/users/me/rotate-token');
  return data.api_token;
}
