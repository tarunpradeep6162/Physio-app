import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { drawAngleArc, drawSkeleton, drawPlumbLine } from '../../camera/overlay';
import { BrandMark } from '../../components/icons';
import { AuthError, requestPasswordReset, serverMode, setNewPassword, signIn, signInDemo, signUp, useSessionUserId } from '../../data/auth';
import { ensureDemoData } from '../../data/demo';
import type { Role } from '../../data/models';
import { getDb } from '../../data/store';
import { idx } from '../../engine/landmarks';
import { synthesize } from '../../engine/pose/synthetic';
import { useT } from '../../i18n';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

/** Animated synthetic skeleton for the welcome screen (labelled as illustration). */
function HeroVisual() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const reduce = document.documentElement.classList.contains('reduced-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const draw = (now: number) => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (!c || !ctx) return;
      const W = 720;
      const H = 540;
      c.width = W;
      c.height = H;
      ctx.clearRect(0, 0, W, H);
      const k = reduce ? 0.8 : 0.5 - 0.5 * Math.cos(((now - start) / 1000) * 1.3);
      const flex = 6 + k * 86;
      const lm = synthesize({ kind: 'standing_lateral', side: 'left', kneeFlexion: flex }, { width: W, height: H * 1.05 });
      drawPlumbLine(ctx, lm[idx('ankle', 'right')].x, W, H);
      drawSkeleton(ctx, lm, W, H, { mirrored: false, focus: [idx('hip', 'left'), idx('knee', 'left'), idx('ankle', 'left')], state: flex >= 80 ? 'target' : 'tracked' });
      drawAngleArc(ctx, lm[idx('hip', 'left')], lm[idx('knee', 'left')], lm[idx('ankle', 'left')], W, H, `${Math.round(flex)}°`, false, flex >= 80 ? 'target' : 'tracked');
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} aria-label="Illustration: skeleton overlay measuring knee flexion" role="img" />;
}

export function Welcome() {
  const { t } = useT();
  const nav = useNavigate();
  const demo = (role: Role) => {
    ensureDemoData();
    signInDemo(role);
    nav(role === 'patient' ? '/p/home' : '/c/overview');
  };
  return (
    <div className="hero">
      <div className="hero-inner">
        <div className="brand" style={{ color: '#ecfdfa' }}>
          <BrandMark />
          {t('app.name')}
        </div>
        <div className="hero-visual">
          <HeroVisual />
        </div>
        <div className="stack">
          <h1>{t('welcome.title')}</h1>
          <p className="muted">{t('welcome.body')}</p>
          <ul className="stack tight" style={{ margin: 0, paddingLeft: '1.1rem', color: '#bfd9d4' }}>
            <li>{t('welcome.point1')}</li>
            <li>{t('welcome.point2')}</li>
            <li>{t('welcome.point3')}</li>
          </ul>
        </div>
        <div className="stack tight" style={{ marginTop: 'auto' }}>
          <Link className="btn primary lg" to="/auth?mode=signup">
            {t('welcome.get_started')}
          </Link>
          <Link className="btn secondary lg" to="/auth?mode=signin">
            {t('welcome.have_account')}
          </Link>
          <div className="row wrap" style={{ marginTop: '0.5rem' }}>
            <button className="btn ghost grow" style={{ color: '#bfd9d4', minWidth: '10rem' }} onClick={() => demo('patient')}>
              {t('welcome.demo_patient')}
            </button>
            <button className="btn ghost grow" style={{ color: '#bfd9d4', minWidth: '10rem' }} onClick={() => demo('clinician')}>
              {t('welcome.demo_clinician')}
            </button>
          </div>
          <nav className="welcome-links" aria-label={t('about.links')}>
            <Link to="/about">{t('about.how')}</Link>
            <Link to="/privacy">{t('about.privacy')}</Link>
          </nav>
        </div>
      </div>
    </div>
  );
}

export function AuthScreen() {
  const { t } = useT();
  const nav = useNavigate();
  const params = new URLSearchParams(location.search);
  const server = serverMode();
  const initial = params.get('mode');
  const [mode, setMode] = useState<AuthMode>(initial === 'signin' ? 'signin' : initial === 'reset' && server ? 'reset' : initial === 'forgot' && server ? 'forgot' : 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('patient');
  const [err, setErr] = useState<string | null>(null);
  // Supabase sends people back with "#error=…" when an email link has expired or was already used.
  const linkError = typeof location !== 'undefined' && /(^|[#&])error_code=/.test(location.hash);
  const [info, setInfo] = useState<string | null>(linkError ? t('auth.link_invalid') : null);
  const [busy, setBusy] = useState(false);
  // Every new account must acknowledge that this is a pilot build: it is not yet approved for real
  // patient information (local mode additionally keeps everything in this browser only).
  const [ack, setAck] = useState(false);
  const uid = useSessionUserId();

  // Server mode: an email-confirmation link opens the app already signed in — continue to the app.
  useEffect(() => {
    if (!server || !uid || mode === 'reset') return;
    const u = getDb().users.find((x) => x.id === uid);
    if (u && !u.isDemo) nav(u.role === 'patient' ? '/p/home' : '/c/overview', { replace: true });
  }, [server, uid, mode, nav]);

  const go = (u: { role: Role }, fresh: boolean) => nav(u.role === 'patient' ? (fresh ? '/onboarding' : '/p/home') : '/c/overview');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'signup' && !ack) return;
    setErr(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === 'signup') go(await signUp({ email, password, name, role }), true);
      else if (mode === 'signin') go(await signIn(email, password), false);
      else if (mode === 'forgot') {
        await requestPasswordReset(email);
        setInfo(t('auth.reset_sent'));
      } else go(await setNewPassword(password), false);
    } catch (x) {
      if (x instanceof AuthError && x.code === 'confirm') setInfo(t('auth.error_confirm'));
      else setErr(x instanceof AuthError ? t(`auth.error_${x.code}`) : String(x));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'signup' ? t('auth.create_account') : mode === 'signin' ? t('auth.sign_in') : mode === 'forgot' ? t('auth.forgot_title') : t('auth.reset_title');
  const needsPassword = mode !== 'forgot';
  const needsEmail = mode !== 'reset';

  return (
    <div className="content narrow stack loose" style={{ paddingTop: '2rem' }}>
      <Link to="/" className="brand">
        <BrandMark />
        {t('app.name')}
      </Link>
      <h1>{title}</h1>
      <form className="stack" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label className="field">
              <span>{t('auth.name')}</span>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
            {server ? (
              // The role is never chosen by the user on the server: physiotherapist accounts are
              // enabled only by the clinic owner's allowlist.
              <p className="small muted" role="note">
                {t('auth.server_role_note')}
              </p>
            ) : (
              <div className="field">
                <span>{t('auth.role')}</span>
                <div className="segmented" role="radiogroup">
                  {(['patient', 'clinician'] as Role[]).map((r) => (
                    <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}>
                      {t(`auth.role_${r}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {needsEmail && (
          <label className="field">
            <span>{t('auth.email')}</span>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
        )}
        {needsPassword && (
          <label className="field">
            <span>{mode === 'reset' ? t('auth.new_password') : t('auth.password')}</span>
            <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
            {mode !== 'signin' && <small className="muted">{t('auth.password_hint')}</small>}
          </label>
        )}
        {mode === 'signup' && (
          <div className="notice warn stack tight" role="note">
            <strong>{t('auth.pilot_title')}</strong>
            <span className="small">{server ? t('auth.pilot_body_server') : t('auth.pilot_body')}</span>
            <label className="row" style={{ gap: '0.5rem', alignItems: 'flex-start' }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: '0.25rem', minWidth: 24, minHeight: 24 }} />
              <span className="small">{t('auth.pilot_ack')}</span>
            </label>
          </div>
        )}
        {err && (
          <p role="alert" style={{ color: 'var(--red-ink)' }}>
            {err}
          </p>
        )}
        {info && (
          <p role="status" className="notice">
            {info}
          </p>
        )}
        <button className="btn primary lg" disabled={busy || (mode === 'signup' && !ack)}>
          {mode === 'forgot' ? t('auth.send_reset') : mode === 'reset' ? t('auth.save_password') : title}
        </button>
      </form>
      <button
        className="btn ghost"
        onClick={() => {
          setErr(null);
          setInfo(null);
          setMode(mode === 'signup' ? 'signin' : 'signup');
        }}
      >
        {mode === 'signup' ? t('welcome.have_account') : t('auth.create_account')}
      </button>
      {server && mode === 'signin' && (
        <button className="btn ghost" onClick={() => setMode('forgot')}>
          {t('auth.forgot')}
        </button>
      )}
      <p className="xs muted">{server ? t('auth.server_notice') : t('auth.local_notice')}</p>
    </div>
  );
}
