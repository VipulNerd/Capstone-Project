import { Suspense, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button, Spinner } from '../common';
import config from '../../config';
import styles from './AppLayout.module.css';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '🏠', end: true },
  { to: '/live/new', label: 'Live capture', icon: '🔴' },
  { to: '/meetings/new', label: 'Upload recording', icon: '⬆️' },
  { to: '/history', label: 'History', icon: '🗂️' },
  { to: '/search', label: 'Search', icon: '🔎' },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [lastPath, setLastPath] = useState(location.pathname);

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
        {config.USE_MOCK && <div className={styles.mockBadge}>Demo mode · mock API</div>}
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
        <main className={styles.content}>
          <Suspense fallback={<Spinner label="Loading page…" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
