import { useEffect, useState } from 'react';
import { formatDuration } from '../../utils/speakers';
import styles from './live.module.css';

/** "● REC 04:12". Ticks locally between server updates. */
export default function RecTimer({ elapsed, receivedAt, paused }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (paused) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paused]);

  const shown = paused || !receivedAt ? elapsed : elapsed + Math.max(0, (now - receivedAt) / 1000);

  return (
    <span className={`${styles.rec} ${paused ? styles.recPaused : ''}`} role="timer">
      <span className={`${styles.recDot} ${paused ? styles.pausedDot : ''}`} aria-hidden="true" />
      {paused ? 'PAUSED' : 'REC'} {formatDuration(shown)}
    </span>
  );
}
