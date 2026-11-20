import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, ErrorMessage, Input } from '../components/common';
import { hasErrors, validateLogin } from '../utils/validators';
import config from '../config';
import styles from './pages.module.css';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  // Controlled form state
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  if (isAuthenticated) return <Navigate to={from} replace />;

  const handleChange = (e) => {
    const { name, value } = e.target;
    const next = { ...form, [name]: value };
    setForm(next);
    // Re-validate a field as the user types, once they've visited it.
    if (touched[name]) setErrors(validateLogin(next));
  };

  const handleBlur = (e) => {
    setTouched((t) => ({ ...t, [e.target.name]: true }));
    setErrors(validateLogin(form));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validation = validateLogin(form);
    setErrors(validation);
    setTouched({ email: true, password: true });
    if (hasErrors(validation)) return;

    setSubmitting(true);
    setServerError(null);
    try {
      await login(form.email.trim(), form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.authWrap}>
      <form className={`card ${styles.authCard}`} onSubmit={handleSubmit} noValidate>
        <div className={styles.authHeader}>
          <span className={styles.authLogo} aria-hidden="true">
            📝
          </span>
          <h1>Sign in to MinutesAI</h1>
          <p className="muted">Turn meeting recordings into approved minutes.</p>
        </div>

        <ErrorMessage error={serverError} />

        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={handleChange}
          onBlur={handleBlur}
          error={touched.email && errors.email}
          required
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          onChange={handleChange}
          onBlur={handleBlur}
          error={touched.password && errors.password}
          required
        />

        <Button type="submit" fullWidth loading={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>

        {config.USE_MOCK && (
          <p className={styles.demoHint}>Demo mode: any email and a password of 6+ characters will work.</p>
        )}
      </form>
    </div>
  );
}
