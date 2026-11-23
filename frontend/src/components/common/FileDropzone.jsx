import { useRef, useState } from 'react';
import styles from './common.module.css';
import Button from './Button';
import { formatBytes } from '../../utils/fileHelpers';

/** Drag-and-drop or click-to-browse file picker for a single file. */
export default function FileDropzone({ file, onChange, accept, hint, error }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onChange(dropped);
  };

  if (file) {
    return (
      <div>
        <div className={styles.fileChip}>
          <span aria-hidden="true">📄</span>
          <div>
            <strong>{file.name}</strong>
            <div className="muted small">{formatBytes(file.size)}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
        {error && (
          <p className="small" role="alert" style={{ color: 'var(--danger)', marginTop: 6 }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        className={`${styles.dropzone} ${dragging ? styles.dragging : ''} ${error ? styles.invalid : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <span className={styles.dropzoneIcon} aria-hidden="true">
          ⬆️
        </span>
        <strong>Drop a file here or click to browse</strong>
        {hint && <span className="muted small">{hint}</span>}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            if (e.target.files?.[0]) onChange(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <span className={styles.errorText} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
