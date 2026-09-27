import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { BrandMark, IconChart, IconClipboard, IconFlask, IconGrid, IconHome, IconList, IconProgress, IconScan, IconSettings, IconTrain, IconUser, IconUsers } from '../components/icons';
import { Loader } from '../components/ui';
import { signOut } from '../data/auth';
import { usePrefs } from '../data/prefs';
import { storageError, useDb } from '../data/store';
import { I18nProvider, useT } from '../i18n';
import { useCurrentUser } from './hooks';

// Route-level code splitting: the camera/pose runtime, charts, body map and clinician modules
// load only when needed so the Motion Mirror never waits on dashboard code.
const named = <T extends Record<string, unknown>>(p: Promise<T>, k: keyof T) => p.then((m) => ({ default: m[k] as React.ComponentType }));
const Welcome = lazy(() => named(import('../features/onboarding/Welcome'), 'Welcome'));
const AuthScreen = lazy(() => named(import('../features/onboarding/Welcome'), 'AuthScreen'));
const Onboarding = lazy(() => named(import('../features/onboarding/Onboarding'), 'Onboarding'));
const PatientHome = lazy(() => named(import('../features/patient/PatientPages'), 'PatientHome'));
const PatientTrain = lazy(() => named(import('../features/patient/PatientPages'), 'PatientTrain'));
const PatientProgress = lazy(() => named(import('../features/patient/PatientPages'), 'PatientProgress'));
const PatientProfile = lazy(() => named(import('../features/patient/PatientPages'), 'PatientProfile'));
const KneeAssessment = lazy(() => named(import('../features/knee/KneeAssessment'), 'KneeAssessment'));
const TrainSession = lazy(() => named(import('../features/session/TrainSession'), 'TrainSession'));
const ClinicianOverview = lazy(() => named(import('../features/clinician/ClinicianPages'), 'ClinicianOverview'));
const PatientList = lazy(() => named(import('../features/clinician/ClinicianPages'), 'PatientList'));
const PatientDetail = lazy(() => named(import('../features/clinician/ClinicianPages'), 'PatientDetail'));
const AssessmentQueue = lazy(() => named(import('../features/clinician/AssessmentReview'), 'AssessmentQueue'));
const AssessmentRoute = lazy(() => named(import('../features/knee/AssessmentRoute'), 'AssessmentRoute'));
const ReportRoute = lazy(() => named(import('../features/report/ReportView'), 'ReportRoute'));
const ProgramBuilder = lazy(() => named(import('../features/clinician/ProgramBuilder'), 'ProgramBuilder'));
const ProgramsIndex = lazy(() => named(import('../features/clinician/ProgramsIndex'), 'ProgramsIndex'));
const Analytics = lazy(() => named(import('../features/clinician/AnalyticsSettings'), 'Analytics'));
const ClinicSettingsPage = lazy(() => named(import('../features/clinician/AnalyticsSettings'), 'ClinicSettingsPage'));
const ValidationMode = lazy(() => named(import('../features/validation/ValidationMode'), 'ValidationMode'));

function useDocumentPrefs() {
  const prefs = usePrefs();
  useEffect(() => {
    const h = document.documentElement;
    h.classList.toggle('large-text', prefs.largeText);
    h.classList.toggle('high-contrast', prefs.highContrast);
    h.classList.toggle('reduced-motion', prefs.reducedMotion);
    h.lang = prefs.locale;
  }, [prefs]);
  return prefs;
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function Banners() {
  const { t } = useT();
  const user = useCurrentUser();
  const online = useOnline();
  useDb((d) => d.audit.length); // re-render on writes so storage errors surface
  const err = storageError();
  return (
    <>
      {user?.isDemo && (
        <div className="demo-banner" role="note">
          {t('common.demo_banner')}
        </div>
      )}
      {!online && (
        <div className="demo-banner" style={{ background: '#fff8ea', color: '#5f3f00', borderColor: '#f2cf8e' }} role="status">
          {t('common.offline')}
        </div>
      )}
      {err && (
        <div className="demo-banner" style={{ background: '#fdf1f1', color: '#7c1f1f', borderColor: '#efb4b4' }} role="alert">
          Storage error: {err}
        </div>
      )}
    </>
  );
}

function RequireRole({ role, children }: { role: 'patient' | 'clinician'; children: ReactNode }) {
  const user = useCurrentUser();
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== role) return <Navigate to={user.role === 'patient' ? '/p/home' : '/c/overview'} replace />;
  return <>{children}</>;
}

function Home() {
  const user = useCurrentUser();
  if (user) return <Navigate to={user.role === 'patient' ? '/p/home' : '/c/overview'} replace />;
  return <Welcome />;
}

function PatientLayout() {
  const { t } = useT();
  const items = [
    { to: '/p/home', label: t('nav.home'), icon: IconHome },
    { to: '/p/assess', label: t('nav.assess'), icon: IconScan },
    { to: '/p/train', label: t('nav.train'), icon: IconTrain },
    { to: '/p/progress', label: t('nav.progress'), icon: IconProgress },
    { to: '/p/profile', label: t('nav.profile'), icon: IconUser },
  ];
  return (
    <RequireRole role="patient">
      <div className="shell">
        <Banners />
        <header className="topbar">
          <NavLink to="/p/home" className="brand">
            <BrandMark />
            {t('app.name')}
          </NavLink>
        </header>
        <main id="main">
          <Suspense fallback={<Loader />}>
            <Outlet />
          </Suspense>
        </main>
        <nav className="bottom-nav" aria-label="Primary">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </RequireRole>
  );
}

function ClinicianLayout() {
  const { t } = useT();
  const validation = useDb((d) => d.settings.validationModeEnabled);
  const items = [
    { to: '/c/overview', label: t('nav.overview'), icon: IconGrid },
    { to: '/c/patients', label: t('nav.patients'), icon: IconUsers },
    { to: '/c/assessments', label: t('nav.assessments'), icon: IconClipboard },
    { to: '/c/programs', label: t('nav.programs'), icon: IconList },
    { to: '/c/analytics', label: t('nav.analytics'), icon: IconChart },
    { to: '/c/settings', label: t('nav.settings'), icon: IconSettings },
  ];
  return (
    <RequireRole role="clinician">
      <div className="clin-layout">
        <nav className="side-rail" aria-label="Clinician">
          <NavLink to="/c/overview" className="brand">
            <BrandMark />
            {t('app.name')}
          </NavLink>
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon />
              {label}
            </NavLink>
          ))}
          {validation && (
            <NavLink to="/validation" className="nav-link">
              <IconFlask />
              {t('nav.validation')}
            </NavLink>
          )}
          <button className="btn ghost" style={{ marginTop: 'auto', color: '#9fbdb7', justifyContent: 'flex-start' }} onClick={() => signOut()}>
            {t('nav.sign_out')}
          </button>
        </nav>
        <div className="grow" style={{ minWidth: 0 }}>
          <Banners />
          {/* The side rail (with Sign out) is hidden on narrow screens, so phones and tablets get a top bar. */}
          <header className="topbar clin-topbar">
            <NavLink to="/c/overview" className="brand">
              <BrandMark />
              {t('app.name')}
            </NavLink>
            <button className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => signOut()}>
              {t('nav.sign_out')}
            </button>
          </header>
          <main id="main">
            <Suspense fallback={<Loader />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <nav className="bottom-nav" aria-label="Clinician">
          {items.slice(0, 5).map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}
          <NavLink to="/c/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            <IconSettings />
            <span>{t('nav.settings')}</span>
          </NavLink>
        </nav>
      </div>
    </RequireRole>
  );
}

function ValidationGate() {
  const user = useCurrentUser();
  const enabled = useDb((d) => d.settings.validationModeEnabled);
  if (!user || user.role !== 'clinician' || !enabled) return <Navigate to="/" replace />;
  return <ValidationMode />;
}

export function App() {
  const prefs = useDocumentPrefs();
  return (
    <I18nProvider locale={prefs.locale}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <BrowserRouter>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/auth" element={<AuthScreen />} />
            <Route
              path="/onboarding"
              element={
                <RequireRole role="patient">
                  <Onboarding />
                </RequireRole>
              }
            />
            <Route path="/p" element={<PatientLayout />}>
              <Route index element={<Navigate to="home" replace />} />
              <Route path="home" element={<PatientHome />} />
              <Route path="assess" element={<KneeAssessment />} />
              <Route path="train" element={<PatientTrain />} />
              <Route path="session" element={<TrainSession />} />
              <Route path="progress" element={<PatientProgress />} />
              <Route path="profile" element={<PatientProfile />} />
            </Route>
            <Route path="/c" element={<ClinicianLayout />}>
              <Route index element={<Navigate to="overview" replace />} />
              <Route path="overview" element={<ClinicianOverview />} />
              <Route path="patients" element={<PatientList />} />
              <Route path="patients/:id" element={<PatientDetail />} />
              <Route path="assessments" element={<AssessmentQueue />} />
              <Route path="assessments/:id" element={<AssessmentRoute />} />
              <Route path="programs" element={<ProgramsIndex />} />
              <Route path="programs/new" element={<ProgramBuilder />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="settings" element={<ClinicSettingsPage />} />
            </Route>
            <Route path="/validation" element={<ValidationGate />} />
            <Route path="/report/:id" element={<ReportRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </I18nProvider>
  );
}
