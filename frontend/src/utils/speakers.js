/** Stable colour per speaker name so the same person always looks the same. */
export function colorFor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 48%)`;
}

export function initials(name = '') {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

/** 75 -> "01:15", 3725 -> "1:02:05" */
export function formatDuration(totalSeconds) {
  const s = Math.floor(totalSeconds || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
}
