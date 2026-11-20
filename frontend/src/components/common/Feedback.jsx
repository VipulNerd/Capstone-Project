import styles from './common.module.css';
import Button from './Button';

export function Spinner({ size = 'md', label, inline = false }) {
  const spinner = <span className={`${styles.spinner} ${size === 'sm' ? styles.spinnerSm : ''}`} aria-hidden="true" />;
  if (inline) return spinner;
  return (
    <div className={styles.spinnerWrap} role="status">
      {spinner}
      <span className={label ? '' : 'sr-only'}>{label || 'Loading…'}</span>
    </div>
  );
}

export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;
  const message = typeof error === 'string' ? error : error.message || 'Something went wrong';
  return (
    <div className={styles.alert} role="alert">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon = '📭', title, message, action }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      {title && <h3>{title}</h3>}
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}
