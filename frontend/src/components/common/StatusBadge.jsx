import styles from './common.module.css';
import { STATUS } from '../../utils/status';


export default function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return <span className={`${styles.badge} ${styles[`tone-${s.tone}`]}`}>{s.label}</span>;
}
