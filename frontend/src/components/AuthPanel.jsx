import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export default function AuthPanel({ user, onUserChange }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return undefined;

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      onUserChange(session?.user || null);
    });

    return () => data.subscription.unsubscribe();
  }, [onUserChange]);

  if (!supabase) return null;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) throw result.error;

      if (mode === 'signup' && !result.data.session) {
        setMessage('Account created. Check your email to confirm your account, then sign in.');
      } else {
        onUserChange(result.data.user || null);
      }

      setPassword('');
    } catch (authError) {
      setError(authError.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    onUserChange(null);
  }

  if (user) {
    return (
      <div className="auth-bar">
        <div>
          <span className="auth-status-dot" aria-hidden="true" />
          <span>Signed in as <b>{user.email}</b></span>
        </div>
        <button type="button" className="clear-history" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <section className="auth-page" aria-label="Authentication">
      <div className="auth-card">
        <div className="auth-brand-mark" aria-hidden="true">LM</div>

        <div className="auth-copy">
          <p className="eyebrow">LEGALMETRIX SCANNER</p>
          <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p>
            {mode === 'signin'
              ? 'Sign in to continue to your inspection workspace.'
              : 'Create an account to save inspections and access your history securely.'}
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Email address</span>
            <input
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label>
            <span>Password</span>
            <input
              type="password"
              placeholder="Enter your password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {message && (
          <div className="auth-feedback success" role="status">
            {message}
          </div>
        )}

        {error && (
          <div className="auth-feedback error" role="alert">
            {error}
          </div>
        )}

        <div className="auth-divider">
          <span>OR</span>
        </div>

        <p className="auth-switch-text">
          {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
          <button
            className="auth-switch"
            type="button"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError('');
              setMessage('');
            }}
          >
            {mode === 'signin' ? 'Create account' : 'Sign in'}
          </button>
        </p>

        <p className="auth-note">
          Your inspection history is linked to your authenticated account.
        </p>
      </div>
    </section>
  );
}
