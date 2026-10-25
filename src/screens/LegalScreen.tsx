import type { ReactNode } from 'react';
import { PRIVACY, TERMS, type LegalDocument } from '../legal/content';
import { tr } from '../lib/i18n';

interface LegalScreenProps {
  kind: 'terms' | 'privacy';
  onBack: () => void;
  onSwitch: (kind: 'terms' | 'privacy') => void;
}

export function LegalScreen({ kind, onBack, onSwitch }: LegalScreenProps): ReactNode {
  const doc: LegalDocument = kind === 'terms' ? TERMS : PRIVACY;
  const other = kind === 'terms' ? 'privacy' : 'terms';

  return (
    <div className="screen legal-screen">
      <div className="page-top">
        <button type="button" className="back-btn" onClick={onBack} aria-label={tr('Назад')}>
          ←
        </button>
        <div className="page-heading">
          <span className="label">{tr(doc.kicker)}</span>
          <h1 className="page-title">{tr('Правовая информация')}</h1>
        </div>
      </div>

      <h2 className="legal-title">{tr(doc.title)}</h2>
      <p className="legal-updated">{tr(doc.updated)}</p>
      <p className="lede" style={{ marginTop: 12 }}>{tr(doc.intro)}</p>

      <div className="legal-body">
        {doc.sections.map((section) => (
          <section className="legal-section" key={section.title}>
            <h2>{tr(section.title)}</h2>
            {section.paragraphs?.map((text) => (
              <p key={text.slice(0, 40)}>{tr(text)}</p>
            ))}
            {section.items && (
              <ul>
                {section.items.map((item) => (
                  <li key={item.slice(0, 40)}>{tr(item)}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="legal-foot">
        <button type="button" onClick={() => onSwitch(other)}>
          {other === 'terms' ? tr('Условия использования') : tr('Политика конфиденциальности')}
        </button>
        <span>{tr('Край доски, 2026')}</span>
      </div>
    </div>
  );
}
