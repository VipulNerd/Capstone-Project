import { useId } from 'react';
import styles from './common.module.css';

/** Wraps a form control with a label, a hint and an error message. */
function Field({ label, required, error, hint, id, children, className = '' }) {
  return (
    <div className={`${styles.field} ${className}`}>
      {label && (
        <label htmlFor={id} className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      {children}
      {error ? (
        <span className={styles.errorText} id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : (
        hint && <span className={styles.hint}>{hint}</span>
      )}
    </div>
  );
}

const controlClass = (error) => `${styles.control} ${error ? styles.invalid : ''}`;
const aria = (id, error) => ({
  'aria-invalid': !!error,
  'aria-describedby': error ? `${id}-error` : undefined,
});

export function Input({ label, required, error, hint, className, id, ...props }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <Field label={label} required={required} error={error} hint={hint} id={fieldId} className={className}>
      <input id={fieldId} className={controlClass(error)} {...aria(fieldId, error)} {...props} />
    </Field>
  );
}

export function TextArea({ label, required, error, hint, className, id, rows = 4, ...props }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <Field label={label} required={required} error={error} hint={hint} id={fieldId} className={className}>
      <textarea id={fieldId} rows={rows} className={controlClass(error)} {...aria(fieldId, error)} {...props} />
    </Field>
  );
}

/** options: [{ value, label }] */
export function Select({ label, required, error, hint, className, id, options, placeholder, ...props }) {
  const autoId = useId();
  const fieldId = id || autoId;
  return (
    <Field label={label} required={required} error={error} hint={hint} id={fieldId} className={className}>
      <select id={fieldId} className={controlClass(error)} {...aria(fieldId, error)} {...props}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
