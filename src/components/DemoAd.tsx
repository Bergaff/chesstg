import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tr, trf } from '../lib/i18n';

export function DemoAd({ label, onFinish }: { label: string; onFinish: (rewarded: boolean) => void }): ReactNode {
  const [seconds, setSeconds] = useState(5);
  const done = useRef(false);
  const finish = (value: boolean) => {
    if (done.current) return;
    done.current = true;
    onFinish(value);
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return createPortal(
    <div className="demo-ad" role="dialog" aria-modal="true" aria-label={tr('Демонстрационная реклама')}>
      <div className="demo-card">
        <span className="demo-tag">{tr('Демонстрационный показ')}</span>
        <h2 className="demo-title">{tr('Здесь будет реклама')}</h2>
        <p className="demo-text">
          {tr('В Telegram на этом месте открывается ролик Adsgram. Сейчас включён демонстрационный режим, поэтому показывается заглушка с таймером.')}
        </p>

        <div className="demo-reward">
          <span className="label">{tr('Награда')}</span>
          <b>{label}</b>
        </div>
        <div className="demo-progress" aria-hidden="true">
          <span style={{ width: `${((5 - seconds) / 5) * 100}%` }} />
        </div>
        <div className="demo-actions">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={seconds > 0}
            onClick={() => finish(true)}
          >
            {seconds > 0 ? trf('Забрать через {0} с', [seconds]) : tr('Забрать награду')}
          </button>
          <button type="button" className="btn btn-quiet btn-block" onClick={() => finish(false)}>
            {tr('Закрыть без награды')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
