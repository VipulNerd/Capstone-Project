import axios from 'axios';
import config from '../config';

export const TOKEN_KEY = 'mom_api_token';

// A single axios instance shared by every service.
const client = axios.create({
  baseURL: config.API_BASE_URL,
  timeout: 120000, // audio chunks of up to 25 MB on slow links
});

// Every endpoint except POST /users needs the user's API token.
client.interceptors.request.use((req) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && !req.headers.Authorization) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

// AuthContext registers this so an invalid/rotated token ends the session.
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

// FastAPI errors: { detail: "text" } or, for validation errors, { detail: [{ loc, msg }] }.
function detailToMessage(detail) {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== 'body').join('.') : '';
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join('; ');
  }
  return null;
}

// Normalise every error into { message, status } so pages handle one shape.
client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err.response?.status ?? 0;
    let data = err.response?.data;
    // Blob requests (exports) return the JSON error body as a Blob.
    if (data instanceof Blob) {
      try {
        data = JSON.parse(await data.text());
      } catch {
        data = null;
      }
    }
    let message = detailToMessage(data?.detail);
    if (!message) {
      if (status === 0) message = 'Cannot reach the backend. Is the API running?';
      else if (status === 502 || status === 504) message = 'The backend is not responding. Is it running on port 8000?';
      else if (status >= 500) message = `Server error (${status}). Check the backend logs.`;
      else message = err.message;
    }
    if (status === 401 && err.config && !err.config.skipAuthRedirect) {
      // A request sent with a token that has since been replaced (e.g. rotated in Settings while
      // this request was in flight) is retried once with the current token instead of logging out.
      const current = localStorage.getItem(TOKEN_KEY);
      const sent = err.config.headers?.Authorization;
      if (current && sent && sent !== `Bearer ${current}` && !err.config._retriedWithNewToken) {
        err.config.headers.Authorization = `Bearer ${current}`;
        err.config._retriedWithNewToken = true;
        return client.request(err.config);
      }
      if (unauthorizedHandler) unauthorizedHandler();
    }
    return Promise.reject({ message, status });
  },
);

/** Triggers a browser download for a Blob. */
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default client;
