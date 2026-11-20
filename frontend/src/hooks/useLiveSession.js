import { useEffect, useReducer, useRef } from 'react';
import { connectLiveSession } from '../api/liveService';

const initialState = {
  loading: true,
  error: null,
  title: '',
  status: null,
  paused: false,
  elapsed: 0, // seconds, as of `receivedAt`
  receivedAt: 0,
  transcript: [],
  participants: [],
  invited: 0,
  speaking: null,
};

function upsertParticipant(list, p) {
  const i = list.findIndex((x) => x.name === p.name);
  if (i === -1) return [...list, p];
  return list.map((x, idx) => (idx === i ? { ...x, ...p } : x));
}

// All live updates flow through one reducer, whether they come from a
// full snapshot (mock / reconnect) or from incremental WebSocket events.
function reducer(state, msg) {
  switch (msg.type) {
    case 'snapshot':
      return {
        ...state,
        loading: false,
        error: null,
        title: msg.title,
        status: msg.status,
        paused: msg.paused,
        elapsed: msg.elapsed,
        receivedAt: Date.now(),
        transcript: msg.transcript,
        participants: msg.participants,
        invited: msg.invited ?? state.invited,
        speaking: msg.speaking ?? null,
      };
    case 'transcript':
      return { ...state, transcript: [...state.transcript, msg.line], speaking: msg.line.speaker };
    case 'participant':
      return { ...state, participants: upsertParticipant(state.participants, msg.participant) };
    case 'speaking':
      return { ...state, speaking: msg.speaker };
    case 'status':
      return {
        ...state,
        status: msg.status ?? state.status,
        paused: msg.paused ?? state.paused,
        elapsed: msg.elapsed ?? state.elapsed,
        receivedAt: msg.elapsed !== undefined ? Date.now() : state.receivedAt,
      };
    case 'local-paused':
      return { ...state, paused: msg.paused };
    case 'error':
      return { ...state, loading: false, error: msg.error };
    default:
      return state;
  }
}

/** Subscribes to a live capture session and keeps transcript/participants in state. */
export default function useLiveSession(id) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const connRef = useRef(null);

  useEffect(() => {
    const conn = connectLiveSession(
      id,
      (msg) => dispatch(msg),
      (error) => dispatch({ type: 'error', error }),
    );
    connRef.current = conn;
    return () => conn.close();
  }, [id]);

  return {
    ...state,
    dispatch,
    sendAudio: (blob) => connRef.current?.sendAudio(blob),
    disconnect: () => connRef.current?.close(),
  };
}
