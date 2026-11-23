import styles from './common.module.css';
import { CHUNK_STATUS, DELIVERY_STATUS, STATUS } from '../../utils/status';

const MAPS = { meeting: STATUS, delivery: DELIVERY_STATUS, chunk: CHUNK_STATUS };

/** kind = "meeting" (default) | "delivery" | "chunk". */
export default function StatusBadge({ status, kind = 'meeting' }) {
  const s = MAPS[kind][status] || { label: status, tone: 'neutral' };
  return <span className={`${styles.badge} ${styles[`tone-${s.tone}`]}`}>{s.label}</span>;
}
