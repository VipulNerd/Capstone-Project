import { Link } from 'react-router-dom';
import styles from './common.module.css';

/**
 * Reusable button. Pass `to` to render a router <Link> styled as a button.
 * variant: primary | secondary | danger | ghost      size: md | sm
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  to,
  className = '',
  children,
  disabled,
  type = 'button',
  ...rest
}) {
  const classes = [
    styles.btn,
    styles[variant],
    size === 'sm' && styles.sm,
    fullWidth && styles.full,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  if (to) {
    return (
      <Link to={to} className={classes} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading && <span className={`${styles.spinner} ${styles.spinnerSm}`} aria-hidden="true" />}
      {children}
    </button>
  );
}
