// Central place for environment-driven configuration.
// Vite only exposes variables prefixed with VITE_ to the browser.
const flag = (value) => String(value ?? '').toLowerCase() === 'true';

const config = {
  // "/api" is proxied to the FastAPI backend by Vite (dev) and nginx (Docker).
  // Set a full URL (e.g. https://mom-api.azurewebsites.net) to call the backend directly;
  // the backend's CORS_ORIGINS must then include this site's origin.
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || '/api',
  POLL_INTERVAL_MS: 2000,
  // The backend asks for 2–5 minute slices; longer slices give more consistent speaker labels.
  CHUNK_SECONDS: Number(import.meta.env.VITE_CHUNK_SECONDS) || 120,
  // Must match the backend's MAX_CHUNK_MB (OpenAI transcription limit is 25 MB per file).
  MAX_CHUNK_MB: Number(import.meta.env.VITE_MAX_CHUNK_MB) || 25,
  FEATURES: {
    // Semantic search has no backend endpoint yet. Off by default.
    search: flag(import.meta.env.VITE_FEATURE_SEARCH),
  },
};

export default config;
