import { PATHWAY_ORDER, type PathwayRegion } from '../../clinical/pathways';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentPatient, useCurrentUser } from '../../app/hooks';
import { IconCamera, IconShield } from '../../components/icons';
import { Notice, Segmented, Steps } from '../../components/ui';
import type { ConsentType } from '../../data/models';
import { setPrefs } from '../../data/prefs';
import { insert, update, uuid } from '../../data/store';
import { LOCALES, useT, type Locale } from '../../i18n';

/** Profile → consent/privacy → current concern → assessment. Consent is never buried. */

export const CONSENT_TEXT_VERSION = '2026-09';

export function Onboarding() {
  const { t, locale } = useT();
  const nav = useNavigate();
  const user = useCurrentUser();
  const patient = useCurrentPatient();
  const [step, setStep] = useState(0);
  const [dob, setDob] = useState(patient?.dob ?? '');
  const [sex, setSex] = useState<string>(patient?.sex ?? '');
  const [phone, setPhone] = useState(patient?.phone ?? '');
  const [height, setHeight] = useState(patient?.heightCm?.toString() ?? '');
  const [lang, setLang] = useState<Locale>(locale);
  const [consent, setConsent] = useState<Record<Exclude<ConsentType, 'activity_steps' | 'activity_walking'>, boolean>>({ camera_processing: false, data_storage: false, image_storage: false, research_export: false });
  const [concern, setConcern] = useState(patient?.concern ?? '');
  const [goal, setGoal] = useState(patient?.goal ?? '');
  const [area, setArea] = useState<PathwayRegion>('knee');

  if (!user || !patient) return null;

  const saveProfile = () => {
    update('patients', patient.id, { dob: dob || undefined, sex: (sex || undefined) as 'female' | 'male' | 'other' | undefined, phone: phone || undefined, heightCm: height ? Number(height) : undefined, preferredLanguage: lang }, user.id, 'profile');
    setPrefs({ locale: lang });
    setStep(1);
  };
  const saveConsent = () => {
    const at = new Date().toISOString();
    (Object.keys(consent) as (keyof typeof consent)[]).forEach((type) => insert('consents', { id: uuid(), patientId: patient.id, type, granted: consent[type], textVersion: CONSENT_TEXT_VERSION, at }, user.id, 'consent'));
    setStep(2);
  };
  const finish = () => {
    update('patients', patient.id, { concern, goal }, user.id, 'concern');
    nav(area === 'knee' ? '/p/assess' : `/p/assess/${area}`);
  };

  return (
    <div className="content narrow stack loose" style={{ paddingTop: '1.5rem' }}>
      <div className="stack tight">
        <span className="eyebrow">{t('onb.step', { n: step + 1, total: 3 })}</span>
        <Steps total={3} current={step} />
      </div>

      {step === 0 && (
        <section className="stack">
          <h1>{t('onb.profile.title')}</h1>
          <label className="field">
            <span>{t('onb.profile.dob')}</span>
            <input className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          </label>
          <div className="field">
            <span>{t('onb.profile.sex')}</span>
            <div className="segmented">
              {(['female', 'male', 'other'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={sex === s} onClick={() => setSex(s)}>
                  {t(`onb.profile.sex_${s}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>{t('onb.profile.height')}</span>
            <input className="input" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="field">
            <span>{t('onb.profile.phone')}</span>
            <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </label>
          <div className="field">
            <span>{t('onb.profile.language')}</span>
            <div className="segmented">
              {LOCALES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={lang === l.id}
                  onClick={() => {
                    setLang(l.id);
                    setPrefs({ locale: l.id });
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {lang === 'ta' && <small className="muted">{t('profile.ta_notice')}</small>}
          </div>
          <button className="btn primary lg" onClick={saveProfile}>
            {t('common.continue')}
          </button>
        </section>
      )}

      {step === 1 && (
        <section className="stack">
          <h1>{t('onb.consent.title')}</h1>
          <p className="muted">{t('onb.consent.lead')}</p>
          <div className="panel dark stack">
            <div className="row top">
              <IconCamera width={22} style={{ color: 'var(--cyan)', flex: 'none' }} />
              <div className="stack tight">
                <strong>{t('onb.consent.camera_title')}</strong>
                <p className="small muted">{t('onb.consent.camera_body')}</p>
              </div>
            </div>
            <div className="row top">
              <IconShield width={22} style={{ color: 'var(--cyan)', flex: 'none' }} />
              <div className="stack tight">
                <strong>{t('onb.consent.video_title')}</strong>
                <p className="small muted">{t('onb.consent.video_body')}</p>
              </div>
            </div>
          </div>
          <div className="panel stack tight">
            <strong>{t('onb.consent.share_title')}</strong>
            <p className="small muted">{t('onb.consent.share_body')}</p>
            <strong style={{ marginTop: '0.5rem' }}>{t('onb.consent.accuracy_title')}</strong>
            <p className="small muted">{t('onb.consent.accuracy_body')}</p>
          </div>
          <div className="panel list">
            {(['camera_processing', 'data_storage', 'image_storage', 'research_export'] as const).map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={consent[c]} onChange={(e) => setConsent((x) => ({ ...x, [c]: e.target.checked }))} />
                <span>{t(`onb.consent.c_${c === 'camera_processing' ? 'camera' : c === 'data_storage' ? 'storage' : c === 'image_storage' ? 'images' : 'research'}`)}</span>
              </label>
            ))}
          </div>
          {!(consent.camera_processing && consent.data_storage) && <Notice>{t('onb.consent.required')}</Notice>}
          <div className="row">
            <button className="btn secondary" onClick={() => setStep(0)}>
              {t('common.back')}
            </button>
            <button className="btn primary lg grow" onClick={saveConsent}>
              {t('common.continue')}
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="stack">
          <h1>{t('onb.concern.title')}</h1>
          <label className="field">
            <span className="sr-only">{t('onb.concern.title')}</span>
            <textarea className="input" value={concern} onChange={(e) => setConcern(e.target.value)} placeholder={t('onb.concern.placeholder')} />
          </label>
          <div className="stack tight">
            <span>{t('onb.area')}</span>
            <Segmented<PathwayRegion> label={t('onb.area')} value={area} onChange={setArea} options={PATHWAY_ORDER.map((id) => ({ id, label: t(`onb.area_${id}`) }))} />
          </div>
          <label className="field">
            <span>{t('onb.concern.goal')}</span>
            <textarea className="input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('onb.concern.goal_placeholder')} />
          </label>
          <div className="row">
            <button className="btn secondary" onClick={() => setStep(1)}>
              {t('common.back')}
            </button>
            <button className="btn primary lg grow" onClick={finish}>
              {t('onb.finish')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
