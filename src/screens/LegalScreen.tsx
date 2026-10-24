import type { ReactNode } from 'react';
import { PRIVACY, TERMS, type LegalDocument } from '../legal/content';

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
        <button type="button" className="back-btn" onClick={onBack} aria-label="Назад">
          ←
        </button>
        <div className="page-heading">
          <span className="label">{doc.kicker}</span>
          <h1 className="page-title">Правовая информация</h1>
        </div>
      </div>

      <h2 className="legal-title">{doc.title}</h2>
      <p className="legal-updated">{doc.updated}</p>
      <p className="lede" style={{ marginTop: 12 }}>{doc.intro}</p>

      <div className="legal-body">
        {doc.sections.map((section) => (
          <section className="legal-section" key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((text) => (
              <p key={text.slice(0, 40)}>{text}</p>
            ))}
            {section.items && (
              <ul>
                {section.items.map((item) => (
                  <li key={item.slice(0, 40)}>{item}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="legal-foot">
        <button type="button" onClick={() => onSwitch(other)}>
          {other === 'terms' ? 'Условия использования' : 'Политика конфиденциальности'}
        </button>
        <span>Край доски, 2026</span>
      </div>
    </div>
  );
}
