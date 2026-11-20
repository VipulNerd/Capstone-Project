/**
 * Captures meeting audio in the browser.
 *
 * The organiser picks the Teams tab (or window) in the browser's share dialog
 * and ticks "Share tab audio". That gives us everyone else's voices; the
 * organiser's own microphone is mixed in so their speech is captured too.
 * The mixed stream is recorded in short chunks and handed to `onChunk`,
 * which sends them to the backend over the live WebSocket.
 */
export async function startAudioCapture(onChunk, { includeMic = true, chunkMs = 1000 } = {}) {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw { message: 'This browser cannot capture tab audio. Use Chrome or Edge.' };
  }

  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  if (!display.getAudioTracks().length) {
    display.getTracks().forEach((t) => t.stop());
    throw { message: 'No audio was shared. Select the Teams tab and tick "Share tab audio".' };
  }

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);

  let mic = null;
  if (includeMic) {
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
      ctx.createMediaStreamSource(mic).connect(dest);
    } catch {
      // Mic is optional: continue with tab audio only.
    }
  }

  const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus' });
  recorder.ondataavailable = (e) => e.data.size && onChunk(e.data);
  recorder.start(chunkMs);

  const stopAll = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    display.getTracks().forEach((t) => t.stop());
    mic?.getTracks().forEach((t) => t.stop());
    ctx.close();
  };
  // If the user clicks the browser's "Stop sharing" bar, end capture too.
  display.getVideoTracks()[0]?.addEventListener('ended', stopAll);

  return {
    pause: () => recorder.state === 'recording' && recorder.pause(),
    resume: () => recorder.state === 'paused' && recorder.resume(),
    stop: stopAll,
  };
}
