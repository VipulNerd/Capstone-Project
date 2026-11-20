import { colorFor, initials } from '../../utils/speakers';
import styles from './live.module.css';

export default function Avatar({ name, speaking = false, className = '' }) {
  return (
    <span
      className={`${styles.avatar} ${speaking ? styles.speakingRing : ''} ${className}`}
      style={{ background: colorFor(name) }}
      title={name}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
