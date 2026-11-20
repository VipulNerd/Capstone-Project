import { Button } from '../components/common';
import styles from './pages.module.css';

export default function NotFoundPage() {
  return (
    <div className={styles.notFound}>
      <strong>404</strong>
      <h1>Page not found</h1>
      <p className="muted">The page you're looking for doesn't exist or has moved.</p>
      <Button to="/">Go to dashboard</Button>
    </div>
  );
}
