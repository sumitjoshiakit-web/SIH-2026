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
        setMessage('Account created. Check your email if email confirmation is enabled.');
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
        <span>Signed in as <b>{user.email}</b></span>
        <button type="button" className="clear-history" onClick={signOut}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <section className="auth-panel" aria-label="Account">
      <div>
        <h2>{mode === 'signin' ? 'Inspector login' : 'Create inspector account'}</h2>
        <p>Enable cloud inspection history and authenticated reports.</p>
      </div>

      <form onSubmit={submit}>
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <button
        className="auth-switch"
        type="button"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin');
          setError('');
          setMessage('');
        }}
      >
        {mode === 'signin'
          ? 'Need an account? Create one'
          : 'Already have an account? Sign in'}
      </button>

      {message && <small className="auth-message">{message}</small>}
      {error && <small className="auth-error">{error}</small>}
    </section>
  );
}
