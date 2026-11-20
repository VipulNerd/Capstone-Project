// Central place for environment-driven configuration.
// Vite only exposes variables prefixed with VITE_ to the browser.
const config = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  // Default to the mock backend unless explicitly disabled.
  USE_MOCK: (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false',
  POLL_INTERVAL_MS: 2000,
  MAX_UPLOAD_MB: 200,
};

export default config;
