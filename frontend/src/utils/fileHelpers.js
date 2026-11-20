export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'mp4', 'webm', 'ogg'];
export const TRANSCRIPT_EXTENSIONS = ['txt', 'vtt', 'srt', 'docx'];

export const getExtension = (name) => name.split('.').pop().toLowerCase();

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Returns an error message, or null if the file is acceptable. */
export function validateFile(file, sourceType, maxMb) {
  if (!file) return 'Please choose a file';
  const allowed = sourceType === 'audio' ? AUDIO_EXTENSIONS : TRANSCRIPT_EXTENSIONS;
  if (!allowed.includes(getExtension(file.name))) {
    return `Unsupported file type. Allowed: ${allowed.join(', ')}`;
  }
  if (file.size > maxMb * 1024 * 1024) return `File is larger than ${maxMb} MB`;
  return null;
}
