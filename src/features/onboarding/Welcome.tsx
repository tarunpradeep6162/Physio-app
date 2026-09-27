import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { drawAngleArc, drawSkeleton, drawPlumbLine } from '../../camera/overlay';
import { BrandMark } from '../../components/icons';
import { AuthError, signIn, signInDemo, signUp } from '../../data/auth';
import { ensureDemoData } from '../../data/demo';
import type { Role } from '../../data/models';
import { idx } from '../../engine/landmarks';
import { synthesize } from '../../engine/pose/synthetic';
import { useT } from '../../i18n';

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
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button className="btn ghost grow" style={{ color: '#bfd9d4' }} onClick={() => demo('patient')}>
              {t('welcome.demo_patient')}
            </button>
            <button className="btn ghost grow" style={{ color: '#bfd9d4' }} onClick={() => demo('clinician')}>
              {t('welcome.demo_clinician')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AuthScreen() {
  const { t } = useT();
  const nav = useNavigate();
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<'signin' | 'signup'>(params.get('mode') === 'signin' ? 'signin' : 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('patient');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const u = await signUp({ email, password, name, role });
        nav(u.role === 'patient' ? '/onboarding' : '/c/overview');
      } else {
        const u = await signIn(email, password);
        nav(u.role === 'patient' ? '/p/home' : '/c/overview');
      }
    } catch (x) {
      setErr(x instanceof AuthError ? t(`auth.error_${x.code}`) : String(x));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content narrow stack loose" style={{ paddingTop: '2rem' }}>
      <Link to="/" className="brand">
        <BrandMark />
        {t('app.name')}
      </Link>
      <h1>{mode === 'signup' ? t('auth.create_account') : t('auth.sign_in')}</h1>
      <form className="stack" onSubmit={submit}>
        {mode === 'signup' && (
          <>
            <label className="field">
              <span>{t('auth.name')}</span>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
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
          </>
        )}
        <label className="field">
          <span>{t('auth.email')}</span>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="field">
          <span>{t('auth.password')}</span>
          <input className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          {mode === 'signup' && <small className="muted">{t('auth.password_hint')}</small>}
        </label>
        {err && (
          <p role="alert" style={{ color: 'var(--red-ink)' }}>
            {err}
          </p>
        )}
        <button className="btn primary lg" disabled={busy}>
          {mode === 'signup' ? t('auth.create_account') : t('auth.sign_in')}
        </button>
      </form>
      <button className="btn ghost" onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>
        {mode === 'signup' ? t('welcome.have_account') : t('auth.create_account')}
      </button>
      <p className="xs muted">{t('auth.local_notice')}</p>
    </div>
  );
}
