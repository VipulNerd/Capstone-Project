import axios from 'axios';
import config from '../config';

export const TOKEN_KEY = 'mom_token';

// A single axios instance shared by every service.
const client = axios.create({
  baseURL: config.API_BASE_URL,
  timeout: 60000,
});

// Attach the auth token (if any) to every request.
client.interceptors.request.use((req) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

// Called on 401 so the app can log the user out. AuthContext registers it.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

// Normalise every error into { message, status } so pages handle one shape.
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status ?? 0;
    const detail = err.response?.data?.detail;
    const message =
      (typeof detail === 'string' && detail) ||
      err.response?.data?.message ||
      (status === 0 ? 'Cannot reach the server. Check your connection.' : err.message);

    if (status === 401 && unauthorizedHandler) unauthorizedHandler();
    return Promise.reject({ message, status });
  },
);

export default client;
