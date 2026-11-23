// Records one audio MediaStream into standalone audio files ("slices") of about `sliceMs` each.
//
// MediaRecorder's own timeslice blobs are NOT standalone files (only the first carries the
// container header), and the backend transcribes every chunk on its own. So each slice is
// produced by a fresh MediaRecorder on the same stream: stop -> emit file -> start the next one.

const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

/** File extension the backend accepts for a recorded MIME type. */
export function extensionFor(mime) {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  return 'webm';
}

export class TrackRecorder {
  /**
   * @param {MediaStream} stream    audio-only stream
   * @param {object} opts
   * @param {'mic'|'meeting'} opts.track
   * @param {number} opts.sliceMs   length of each file
   * @param {() => number} opts.clock  ms since the recording started (shared by both tracks)
   * @param {number} opts.startSeq  next sequence number (continues after a page reload)
   * @param {(chunk) => void} opts.onSlice  receives { track, seq, offsetMs, blob, filename }
   */
  constructor(stream, { track, sliceMs, clock, startSeq = 0, onSlice }) {
    this.stream = stream;
    this.track = track;
    this.sliceMs = sliceMs;
    this.clock = clock;
    this.seq = startSeq;
    this.onSlice = onSlice;
    this.mime = pickMimeType();
    this.recorder = null;
    this.timer = null;
    this.state = 'idle'; // idle | recording | paused | stopped
    this.stopWaiters = [];
  }

  start() {
    if (this.state === 'recording') return;
    this.state = 'recording';
    this.#startSlice();
  }

  /** Pausing closes the current slice, so every file's offset stays exact. */
  pause() {
    if (this.state !== 'recording') return Promise.resolve();
    this.state = 'paused';
    return this.#closeSlice();
  }

  resume() {
    if (this.state === 'paused') this.start();
  }

  /** Emits the last partial slice and releases the microphone / screen capture. */
  async stop() {
    if (this.state === 'stopped') return;
    this.state = 'stopped';
    await this.#closeSlice();
    this.stream.getTracks().forEach((t) => t.stop());
  }

  #startSlice() {
    const options = { audioBitsPerSecond: 32000 }; // ~0.25 MB/min, well under the 25 MB limit
    if (this.mime) options.mimeType = this.mime;
    const recorder = new MediaRecorder(this.stream, options);
    const parts = [];
    const offsetMs = this.clock();
    const seq = this.seq++;
    const type = recorder.mimeType || this.mime || 'audio/webm';

    recorder.ondataavailable = (e) => e.data.size && parts.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(parts, { type });
      if (blob.size) {
        this.onSlice({ track: this.track, seq, offsetMs, blob, filename: `${this.track}-${seq}.${extensionFor(type)}` });
      } else {
        this.seq = Math.min(this.seq, seq); // nothing recorded: reuse the number
      }
      this.recorder = null;
      if (this.state === 'recording') this.#startSlice();
      this.stopWaiters.splice(0).forEach((resolve) => resolve());
    };

    recorder.start();
    this.recorder = recorder;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), this.sliceMs);
  }

  #closeSlice() {
    clearTimeout(this.timer);
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') return Promise.resolve();
    return new Promise((resolve) => {
      this.stopWaiters.push(resolve);
      rec.stop();
    });
  }
}

/** The organiser's microphone (the "mic" track). */
export async function openMicrophone() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

/**
 * Everyone else in the call (the "meeting" track): the audio of a shared tab, window or screen.
 * Browsers require a video track to be requested, so we drop it straight away.
 */
export async function openMeetingAudio() {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false },
    systemAudio: 'include',
  });
  display.getVideoTracks().forEach((t) => t.stop());
  const audio = display.getAudioTracks();
  if (!audio.length) {
    throw new Error(
      'No audio was shared. Share the meeting tab or your screen again and turn on “Share tab audio” / “Share system audio”.',
    );
  }
  return new MediaStream(audio);
}
