import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button, Spinner } from '../common';
import { getHealth } from '../../api/meetingService';
import usePolling from '../../hooks/usePolling';
import config from '../../config';
import styles from './AppLayout.module.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/meetings/new', label: 'Record meeting', icon: '🔴' },
  { to: '/history', label: 'History', icon: '🗂️' },
  config.FEATURES.search && { to: '/search', label: 'Search', icon: '🔎' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
].filter(Boolean);

const HEALTH_INTERVAL_MS = 15000;

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(location.pathname);
  const [apiProblem, setApiProblem] = useState(null);

  // Keep an eye on the backend so a stopped API or database shows up immediately.
  usePolling(async () => {
    try {
      const h = await getHealth();
      setApiProblem(h.database ? null : 'The backend is running but cannot reach its database.');
    } catch (err) {
      setApiProblem(`${err.message} (${config.API_BASE_URL})`);
    }
  }, HEALTH_INTERVAL_MS);

  // Close the mobile menu whenever the route changes.
  if (lastPath !== location.pathname) {
    setLastPath(location.pathname);
    setMenuOpen(false);
  }

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={styles.shell}>
      <aside className={`${styles.sidebar} ${menuOpen ? styles.open : ''}`}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            📝
          </span>
          <div>
            <strong>MinutesAI</strong>
            <div className={styles.tagline}>Meeting minutes, automated</div>
          </div>
        </div>
        <nav className={styles.nav} aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {menuOpen && <div className={styles.overlay} onClick={() => setMenuOpen(false)} />}

      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            className={styles.menuBtn}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            ☰
          </button>
          <div className={styles.spacer} />
          <div className={styles.user}>
            <span className={styles.avatar} aria-hidden="true">
              {(user?.name || user?.email || '?').charAt(0).toUpperCase()}
            </span>
            <span className={styles.userName}>{user?.name || user?.email}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            Log out
          </Button>
        </header>
        {apiProblem && (
          <div className={styles.apiBanner} role="alert">
            ⚠ {apiProblem}
          </div>
        )}
        <main className={styles.content}>
          <Suspense fallback={<Spinner label="Loading page…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
