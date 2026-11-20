import { Button, Input } from '../common';
import styles from './mom.module.css';

/** Editable list of strings (discussion points, decisions). */
export default function EditableList({ items, onChange, placeholder, addLabel = 'Add item', disabled }) {
  const update = (index, value) => onChange(items.map((item, i) => (i === index ? value : item)));
  const remove = (index) => onChange(items.filter((_, i) => i !== index));
  const add = () => onChange([...items, '']);

  return (
    <div>
      <ol className={styles.list}>
        {items.map((item, i) => (
          // Items are plain strings with no id, so index is the only stable key here.
          <li key={i} className={styles.listRow}>
            <span className={styles.index}>{i + 1}.</span>
            <Input
              value={item}
              placeholder={placeholder}
              onChange={(e) => update(i, e.target.value)}
              disabled={disabled}
              aria-label={`${placeholder} ${i + 1}`}
            />
            {!disabled && (
              <Button variant="ghost" size="sm" className={styles.removeBtn} onClick={() => remove(i)} aria-label="Remove">
                ✕
              </Button>
            )}
          </li>
        ))}
      </ol>
      {!items.length && <p className="muted small">Nothing here yet.</p>}
      {!disabled && (
        <Button variant="secondary" size="sm" onClick={add} style={{ marginTop: 10 }}>
          + {addLabel}
        </Button>
      )}
    </div>
  );
}
