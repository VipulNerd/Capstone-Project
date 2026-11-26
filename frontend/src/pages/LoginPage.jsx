import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, ErrorMessage, Input } from '../components/common';
import { hasErrors, isBlank, isEmail, validateNewPassword, validateOrganiser } from '../utils/validators';
import styles from './pages.module.css';

const EMPTY = { name: '', email: '', password: '', confirm: '' };

export default function LoginPage() {
  const { register, login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [mode, setMode] = useState('signin'); // signin | register
  const [form, setForm] = useState({ ...EMPTY, email: location.state?.email || '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  if (isAuthenticated) return <Navigate to={from} replace />;

  const validate = (f) => {
    if (mode === 'register') return { ...validateOrganiser(f), ...validateNewPassword(f.password, f.confirm) };
    const e = {};
    if (isBlank(f.email)) e.email = 'Email is required';
    else if (!isEmail(f.email)) e.email = 'Enter a valid email address';
    if (!f.password) e.password = 'Enter your password';
    return e;
  };

  const setField = (e) => {
    const next = { ...form, [e.target.name]: e.target.value };
    setForm(next);
    if (Object.keys(errors).length) setErrors(validate(next));
  };

  const switchMode = (m) => {
    setMode(m);
    setErrors({});
    setServerError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validation = validate(form);
    setErrors(validation);
    if (hasErrors(validation)) return;
    setSubmitting(true);
    setServerError(null);
    try {
      if (mode === 'register') await register(form.name, form.email, form.password);
      else await login(form.email, form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(
        err.status === 409
          ? { message: 'That email already has an account. Sign in, or use "Forgot password?" if you don\'t know the password.' }
          : err.status === 401
            ? { message: err.message || 'Email or password is incorrect' }
            : err,
      );
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
          <h1>Welcome to MinutesAI</h1>
          <p className="muted">Record your meetings and get approved minutes.</p>
        </div>

        <div className={styles.segmented} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={mode === 'signin' ? styles.segActive : ''}
            onClick={() => switchMode('signin')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? styles.segActive : ''}
            onClick={() => switchMode('register')}
          >
            Create account
          </button>
        </div>

        <ErrorMessage error={serverError} />

        {mode === 'register' && (
          <Input label="Your name" name="name" autoComplete="name" value={form.name} onChange={setField} error={errors.name} />
        )}
        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={setField}
          error={errors.email}
        />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={form.password}
          onChange={setField}
          error={errors.password}
          hint={mode === 'register' ? 'At least 8 characters.' : undefined}
        />
        {mode === 'register' && (
          <Input
            label="Confirm password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onChange={setField}
            error={errors.confirm}
          />
        )}

        <Button type="submit" fullWidth loading={submitting}>
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </Button>

        {mode === 'signin' && (
          <p className={styles.authFooter}>
            <Link to="/forgot-password" state={{ email: form.email }}>
              Forgot password?
            </Link>
          </p>
        )}
      </form>
    </div>
  );
}
