import { useCallback, useEffect, useRef, useState } from 'react';
import { listChunks, uploadChunk } from '../api/meetingService';
import { openMeetingAudio, openMicrophone, TrackRecorder } from '../api/trackRecorder';
import config from '../config';

const MAX_ATTEMPTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (c) => `${c.track}-${c.seq}`;

/**
 * Turns the browser into the backend's "overlay agent":
 *  - mic track: the organiser's microphone
 *  - meeting track: audio of the shared meeting tab/window/screen (everyone else)
 * Each track is cut into standalone slices and uploaded as POST /meetings/{id}/audio.
 * offset_ms is measured from the server's recording_started_at, so both tracks share one
 * clock and a page reload can continue where it left off.
 */
export default function useMeetingRecorder(meeting) {
  const meetingId = meeting?.id;
  const startedAt = meeting ? Date.parse(meeting.recordingStartedAt) : 0;

  const [tracks, setTracks] = useState({ mic: 'off', meeting: 'off' }); // off | starting | on | ended | error
  const [paused, setPaused] = useState(false);
  const [uploads, setUploads] = useState({}); // key -> { track, seq, size, state, error, progress }
  const [error, setError] = useState(null);

  const recorders = useRef({});
  const blobs = useRef({}); // key -> chunk (kept until the server confirms it)
  const nextSeq = useRef(null); // { mic, meeting }, loaded from GET /chunks
  const queue = useRef(Promise.resolve());

  const patch = (key, values) => setUploads((u) => ({ ...u, [key]: { ...u[key], ...values } }));

  // Continue numbering after anything the server already has (e.g. after a reload).
  const loadServerState = useCallback(async () => {
    const chunks = await listChunks(meetingId);
    const seq = { mic: 0, meeting: 0 };
    const known = {};
    for (const c of chunks) {
      seq[c.track] = Math.max(seq[c.track], c.seq + 1);
      known[keyOf(c)] = { track: c.track, seq: c.seq, size: c.size, state: 'done' };
    }
    nextSeq.current = seq;
    setUploads((u) => ({ ...known, ...u }));
    return chunks;
  }, [meetingId]);

  // Sync with the server once per meeting (state is only updated after the request resolves).
  useEffect(() => {
    if (!meetingId) return;
    Promise.resolve()
      .then(loadServerState)
      .catch((e) => setError(e.message));
  }, [meetingId, loadServerState]);

  // Uploads run one at a time, in order, with retries (the endpoint is idempotent).
  const enqueue = useCallback(
    (chunk) => {
      const key = keyOf(chunk);
      blobs.current[key] = chunk;
      patch(key, { track: chunk.track, seq: chunk.seq, size: chunk.blob.size, state: 'queued', error: null, progress: 0 });
      queue.current = queue.current.then(async () => {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            patch(key, { state: 'uploading' });
            await uploadChunk(meetingId, chunk, (progress) => patch(key, { progress }));
            delete blobs.current[key];
            patch(key, { state: 'done', progress: 100 });
            return;
          } catch (err) {
            // 4xx other than 408/429 won't succeed on retry (wrong format, too large, meeting ended).
            const retryable = !err.status || err.status === 408 || err.status === 429 || err.status >= 500;
            if (!retryable || attempt === MAX_ATTEMPTS) {
              patch(key, { state: 'error', error: err.message });
              return;
            }
            await sleep(1000 * 2 ** attempt);
          }
        }
      });
    },
    [meetingId],
  );

  const clock = useCallback(() => Date.now() - startedAt, [startedAt]);

  const startTrack = useCallback(
    async (track) => {
      setError(null);
      setTracks((t) => ({ ...t, [track]: 'starting' }));
      try {
        if (!nextSeq.current) await loadServerState();
        const stream = track === 'mic' ? await openMicrophone() : await openMeetingAudio();
        const rec = new TrackRecorder(stream, {
          track,
          sliceMs: config.CHUNK_SECONDS * 1000,
          clock,
          startSeq: nextSeq.current[track],
          onSlice: (chunk) => {
            nextSeq.current[track] = chunk.seq + 1;
            enqueue(chunk);
          },
        });
        // The user can stop sharing from the browser's own bar.
        stream.getAudioTracks()[0].addEventListener('ended', () => {
          rec.stop();
          setTracks((t) => ({ ...t, [track]: 'ended' }));
        });
        recorders.current[track] = rec;
        if (!paused) rec.start();
        else rec.state = 'paused';
        setTracks((t) => ({ ...t, [track]: 'on' }));
      } catch (err) {
        const denied = err?.name === 'NotAllowedError';
        setError(denied ? `Permission to capture ${track === 'mic' ? 'the microphone' : 'meeting audio'} was denied.` : err.message);
        setTracks((t) => ({ ...t, [track]: 'error' }));
      }
    },
    [clock, enqueue, loadServerState, paused],
  );

  const pause = useCallback(async () => {
    setPaused(true);
    await Promise.all(Object.values(recorders.current).map((r) => r.pause()));
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
    Object.values(recorders.current).forEach((r) => r.resume());
  }, []);

  /** Upload a pre-recorded file as one slice (fallback when nothing could be captured live). */
  const uploadFile = useCallback(
    async (file, track = 'meeting') => {
      if (!nextSeq.current) await loadServerState();
      const seq = nextSeq.current[track]++;
      const ext = file.name.split('.').pop().toLowerCase();
      enqueue({ track, seq, offsetMs: seq === 0 ? 0 : clock(), blob: file, filename: `${track}-${seq}.${ext}` });
    },
    [clock, enqueue, loadServerState],
  );

  const retryFailed = useCallback(() => {
    Object.values(blobs.current).forEach((chunk) => enqueue(chunk));
  }, [enqueue]);

  /**
   * Stops both tracks, waits for every upload, then checks the server has all of them
   * (re-sending any gap). Returns the number of chunks the server holds.
   */
  const finish = useCallback(async () => {
    await Promise.all(Object.values(recorders.current).map((r) => r.stop()));
    recorders.current = {};
    setTracks((t) => ({ mic: t.mic === 'on' ? 'ended' : t.mic, meeting: t.meeting === 'on' ? 'ended' : t.meeting }));
    await queue.current;
    const server = new Set((await listChunks(meetingId)).map(keyOf));
    const missing = Object.values(blobs.current).filter((c) => !server.has(keyOf(c)));
    if (missing.length) {
      missing.forEach((c) => enqueue(c));
      await queue.current;
    }
    const final = await listChunks(meetingId);
    const stillMissing = Object.keys(blobs.current).filter((k) => !final.some((c) => keyOf(c) === k));
    if (stillMissing.length) {
      throw new Error(`${stillMissing.length} audio chunk(s) could not be uploaded. Check your connection and try again.`);
    }
    return final.length;
  }, [enqueue, meetingId]);

  // Release devices if the page is left mid-recording.
  useEffect(
    () => () => {
      Object.values(recorders.current).forEach((r) => r.stop());
    },
    [],
  );

  const list = Object.values(uploads).sort((a, b) => a.track.localeCompare(b.track) || a.seq - b.seq);
  return {
    tracks,
    paused,
    error,
    uploads: list,
    pendingUploads: list.filter((u) => u.state === 'queued' || u.state === 'uploading').length,
    failedUploads: list.filter((u) => u.state === 'error').length,
    capturing: Object.values(tracks).includes('on'),
    startTrack,
    pause,
    resume,
    uploadFile,
    retryFailed,
    finish,
  };
}
