import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { requestPasswordReset } from '../api/userService';
import { Button, ErrorMessage, Input } from '../components/common';
import { hasErrors, isBlank, isEmail, validateNewPassword } from '../utils/validators';
import styles from './pages.module.css';

const RESEND_SECONDS = 60;

/** Step 1: email -> 6-digit code by email. Step 2: code + new password -> signed in. */
export default function ForgotPasswordPage() {
  const { resetPassword, isAuthenticated } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState('email'); // email | code
  const [form, setForm] = useState({ email: location.state?.email || '', code: '', password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [notice, setNotice] = useState('');
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  if (isAuthenticated && step === 'email') return <Navigate to="/" replace />;

  const validate = (f) => {
    const e = {};
    if (isBlank(f.email)) e.email = 'Email is required';
    else if (!isEmail(f.email)) e.email = 'Enter a valid email address';
    if (step === 'code') {
      if (!/^\d{6}$/.test(f.code.trim())) e.code = 'Enter the 6-digit code from the email';
      Object.assign(e, validateNewPassword(f.password, f.confirm));
    }
    return e;
  };

  const setField = (e) => {
    const next = { ...form, [e.target.name]: e.target.value };
    setForm(next);
    if (Object.keys(errors).length) setErrors(validate(next));
  };

  const sendCode = async () => {
    setBusy(true);
    setServerError(null);
    try {
      setNotice(await requestPasswordReset(form.email.trim().toLowerCase()));
      setStep('code');
      setWait(RESEND_SECONDS);
    } catch (err) {
      setServerError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validation = validate(form);
    setErrors(validation);
    if (hasErrors(validation)) return;
    if (step === 'email') return sendCode();
    setBusy(true);
    setServerError(null);
    try {
      await resetPassword(form.email, form.code, form.password);
      toast.success('Password changed. You are signed in.');
      navigate('/', { replace: true });
    } catch (err) {
      setServerError(err.status === 400 ? { message: err.message || 'That code is wrong or has expired.' } : err);
      setBusy(false);
    }
  };

  return (
    <div className={styles.authWrap}>
      <form className={`card ${styles.authCard}`} onSubmit={handleSubmit} noValidate>
        <div className={styles.authHeader}>
          <span className={styles.authLogo} aria-hidden="true">
            🔑
          </span>
          <h1>Reset your password</h1>
          <p className="muted">
            {step === 'email'
              ? "Enter your account's email. We'll send you a 6-digit code."
              : notice || 'Check your email for the 6-digit code.'}
          </p>
        </div>

        <ErrorMessage error={serverError} />

        <Input
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={setField}
          error={errors.email}
          disabled={step === 'code'}
        />

        {step === 'code' && (
          <>
            <Input
              label="6-digit code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={form.code}
              onChange={setField}
              error={errors.code}
              hint="Not there? Check Spam. The code is valid for 15 minutes."
            />
            <Input
              label="New password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={setField}
              error={errors.password}
              hint="At least 8 characters."
            />
            <Input
              label="Confirm new password"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={setField}
              error={errors.confirm}
            />
          </>
        )}

        <Button type="submit" fullWidth loading={busy}>
          {step === 'email' ? 'Send code' : 'Set new password and sign in'}
        </Button>

        {step === 'code' && (
          <Button type="button" variant="secondary" fullWidth disabled={wait > 0 || busy} onClick={sendCode}>
            {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
          </Button>
        )}

        <p className={styles.authFooter}>
          <Link to="/login" state={{ email: form.email }}>
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
