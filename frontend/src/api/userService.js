import client from './client';

const session = (data) => ({
  user: { id: data.id, name: data.name, email: data.email, hasPassword: data.has_password !== false },
  token: data.api_token,
});

/** POST /users: creates the account and signs in. */
export async function register(name, email, password) {
  const { data } = await client.post('/users', { name, email, password }, { skipAuthRedirect: true });
  return session(data);
}

/** POST /auth/login: a new session for this browser (other browsers stay signed in). */
export async function login(email, password) {
  const { data } = await client.post('/auth/login', { email, password }, { skipAuthRedirect: true });
  return session(data);
}

/** POST /auth/logout: ends this browser's session only. */
export async function logout() {
  await client.post('/auth/logout', null, { skipAuthRedirect: true });
}

/** POST /auth/forgot-password: emails a 6-digit code (same answer whether or not the account exists). */
export async function requestPasswordReset(email) {
  const { data } = await client.post('/auth/forgot-password', { email }, { skipAuthRedirect: true });
  return data.message;
}

/** POST /auth/reset-password: sets the new password and signs in; every other session is ended. */
export async function resetPassword(email, code, newPassword) {
  const { data } = await client.post(
    '/auth/reset-password',
    { email, code, new_password: newPassword },
    { skipAuthRedirect: true },
  );
  return session(data);
}

/** PUT /users/me/password: other browsers are signed out, this one stays signed in. */
export async function changePassword(currentPassword, newPassword) {
  const { data } = await client.put('/users/me/password', {
    current_password: currentPassword || null,
    new_password: newPassword,
  });
  return { id: data.id, name: data.name, email: data.email, hasPassword: data.has_password !== false };
}

/** GET /users/me */
export async function getMe(token) {
  const { data } = await client.get('/users/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    skipAuthRedirect: !!token,
  });
  return { id: data.id, name: data.name, email: data.email, hasPassword: data.has_password !== false };
}

/** Issues a new API token for scripts; every other session (all browsers) stops working. */
export async function rotateToken() {
  const { data } = await client.post('/users/me/rotate-token');
  return data.api_token;
}
