import client, { TOKEN_KEY } from './client';
import config from '../config';
import * as mock from './mockServer';

/** Today's Teams meetings for the signed-in organiser (Microsoft Graph via the backend). */
export async function listTeamsMeetings() {
  if (config.USE_MOCK) return mock.listTeamsMeetings();
  const { data } = await client.get('/teams/meetings', { params: { range: 'today' } });
  return data;
}

/** Creates a live capture session for a Teams meeting. Returns { id, status: 'live' }. */
export async function startLiveSession({ teamsMeetingId, joinUrl, title }) {
  if (config.USE_MOCK) return mock.startLiveSession({ teamsMeetingId, joinUrl, title });
  const { data } = await client.post('/live-sessions', { teamsMeetingId, joinUrl, title });
  return data;
}

export async function getLiveState(id) {
  if (config.USE_MOCK) return mock.getLiveState(id);
  const { data } = await client.get(`/live-sessions/${id}`);
  return data;
}

export async function setPaused(id, paused) {
  if (config.USE_MOCK) return mock.pauseLiveSession(id, paused);
  const { data } = await client.post(`/live-sessions/${id}/${paused ? 'pause' : 'resume'}`);
  return data;
}

/** Ends capture; the backend then generates the MOM draft. */
export async function stopLiveSession(id) {
  if (config.USE_MOCK) return mock.stopLiveSession(id);
  const { data } = await client.post(`/live-sessions/${id}/stop`);
  return data;
}

export async function getTranscript(meetingId) {
  if (config.USE_MOCK) return mock.getTranscript(meetingId);
  const { data } = await client.get(`/meetings/${meetingId}/transcript`);
  return data;
}

/**
 * Opens the real-time channel for a session.
 *
 * Server → client messages (JSON):
 *   { type: 'snapshot', ...state }              full state on connect
 *   { type: 'transcript', line: {id,t,speaker,text} }
 *   { type: 'participant', participant: {name,email,source,joinedAt} }
 *   { type: 'speaking', speaker }
 *   { type: 'status', status, paused }
 * Client → server: binary audio chunks (webm/opus) from audioCapture.js.
 *
 * Returns { sendAudio(blob), close() }.
 */
export function connectLiveSession(id, onMessage, onError) {
  if (config.USE_MOCK) {
    // The mock has no socket, so poll a snapshot every second instead.
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        onMessage({ type: 'snapshot', ...(await mock.getLiveState(id)) });
      } catch (err) {
        onError?.(err);
      }
      if (!stopped) setTimeout(tick, 1000);
    };
    tick();
    return { sendAudio: () => {}, close: () => (stopped = true) };
  }

  const wsUrl = `${config.API_BASE_URL.replace(/^http/, 'ws')}/ws/live-sessions/${id}?token=${encodeURIComponent(
    localStorage.getItem(TOKEN_KEY) || '',
  )}`;
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onerror = () => onError?.({ message: 'Live connection error' });
  ws.onclose = (e) => e.code !== 1000 && onError?.({ message: 'Live connection closed' });
  return {
    sendAudio: (blob) => ws.readyState === WebSocket.OPEN && ws.send(blob),
    close: () => ws.close(1000),
  };
}
