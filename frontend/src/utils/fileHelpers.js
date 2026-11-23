// Must match backend/app/services/storage.py AUDIO_EXTENSIONS
export const AUDIO_EXTENSIONS = ['webm', 'ogg', 'wav', 'mp3', 'm4a', 'flac', 'mp4', 'mpeg', 'mpga'];

export const getExtension = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Returns an error message, or null if the file is acceptable. */
export function validateAudioFile(file, maxMb) {
  if (!file) return 'Please choose a file';
  if (!AUDIO_EXTENSIONS.includes(getExtension(file.name))) {
    return `Unsupported file type. Allowed: ${AUDIO_EXTENSIONS.join(', ')}`;
  }
  if (!file.size) return 'The file is empty';
  if (file.size > maxMb * 1024 * 1024) return `File is larger than ${maxMb} MB. Split it or compress it first.`;
  return null;
}

export function validateIcsFile(file) {
  if (!file) return 'Choose the meeting invite (.ics)';
  if (getExtension(file.name) !== 'ics') return 'Choose an .ics calendar invite';
  if (file.size > 1024 * 1024) return 'Invite file is larger than 1 MB';
  return null;
}
