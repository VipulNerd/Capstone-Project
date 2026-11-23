import { useState } from 'react';
import Button from './Button';
import styles from './common.module.css';

/** Shows an API token once, with a copy button. */
export default function TokenReveal({ token }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={styles.tokenBox}>
      <code>{token}</code>
      <Button size="sm" variant="secondary" onClick={copy}>
        {copied ? '✓ Copied' : 'Copy'}
      </Button>
    </div>
  );
}
