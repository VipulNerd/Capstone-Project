import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button, ErrorMessage, Input, TokenReveal } from '../components/common';
import { hasErrors, isBlank, validateOrganiser } from '../utils/validators';
import styles from './pages.module.css';

export default function LoginPage() {
  const { register, loginWithToken, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || '/';

  const [mode, setMode] = useState('register'); // register | token
  const [form, setForm] = useState({ name: '', email: '', token: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [newToken, setNewToken] = useState(null);

  // Stay on this page after registering until the user has seen their token.
  if (isAuthenticated && !newToken) return <Navigate to={from} replace />;

  const validate = (f) => (mode === 'register' ? validateOrganiser(f) : isBlank(f.token) ? { token: 'Paste your API token' } : {});

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
      if (mode === 'register') {
        setNewToken(await register(form.name, form.email));
      } else {
        await loginWithToken(form.token);
        navigate(from, { replace: true });
      }
    } catch (err) {
      setServerError(
        err.status === 409
          ? { message: 'That email already has an account. Sign in with its API token instead.' }
          : err.status === 401
            ? { message: 'That token is not valid. It may have been replaced by a newer one.' }
            : err,
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (newToken) {
    return (
      <div className={styles.authWrap}>
        <div className={`card ${styles.authCard}`}>
          <div className={styles.authHeader}>
            <span className={styles.authLogo} aria-hidden="true">
              🔑
            </span>
            <h1>Save your API token</h1>
            <p className="muted">
              This is your sign-in key. It's shown <strong>only once</strong>. Keep it somewhere safe to sign in on
              another browser.
            </p>
          </div>
          <TokenReveal token={newToken} />
          <Button fullWidth onClick={() => navigate(from, { replace: true })}>
            I've saved it, continue
          </Button>
        </div>
      </div>
    );
  }

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
            aria-selected={mode === 'register'}
            className={mode === 'register' ? styles.segActive : ''}
            onClick={() => switchMode('register')}
          >
            Create account
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'token'}
            className={mode === 'token' ? styles.segActive : ''}
            onClick={() => switchMode('token')}
          >
            I have a token
          </button>
        </div>

        <ErrorMessage error={serverError} />

        {mode === 'register' ? (
          <>
            <Input label="Your name" name="name" autoComplete="name" value={form.name} onChange={setField} error={errors.name} />
            <Input
              label="Your email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={setField}
              error={errors.email}
            />
          </>
        ) : (
          <Input
            label="API token"
            name="token"
            placeholder="mom_…"
            autoComplete="off"
            value={form.token}
            onChange={setField}
            error={errors.token}
            hint="The token you saved when you created your account (or from Settings → New token)."
          />
        )}

        <Button type="submit" fullWidth loading={submitting}>
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
