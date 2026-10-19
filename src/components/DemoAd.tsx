import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

interface DemoAdProps {
  label: string;
  onFinish: (rewarded: boolean) => void;
}

export function DemoAd({ label, onFinish }: DemoAdProps): ReactNode {
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
    <div className="demo-ad" role="dialog" aria-modal="true" aria-label="Демонстрационная реклама">
      <div className="demo-ad-top">
        <span className="demo-ad-tag">РЕКЛАМА · ДЕМО</span>
        <button type="button" className="demo-ad-close" onClick={() => finish(false)} aria-label="Закрыть рекламу">
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="demo-ad-creative">
        <div className="demo-ad-board" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, index) => (
            <span key={index} className={(Math.floor(index / 4) + index) % 2 === 0 ? 'light' : 'dark'} />
          ))}
          <b className="demo-ad-pawn">♟</b>
        </div>
        <span className="demo-ad-eyebrow">Шахматный клуб «Гамбит»</span>
        <h2>Играй головой.<br />Побеждай сердцем.</h2>
        <p>Так выглядит место rewarded-видео Adsgram. В боевом режиме здесь показывается настоящая реклама.</p>
      </div>

      <div className="demo-ad-bottom">
        <div className="demo-ad-reward">
          <Icon name="spark" size={18} />
          <span>Награда: {label}</span>
        </div>
        <div className="demo-ad-progress">
          <span style={{ width: `${((5 - seconds) / 5) * 100}%` }} />
        </div>
        <button
          type="button"
          className="btn btn-gold demo-ad-claim"
          disabled={seconds > 0}
          onClick={() => finish(true)}
        >
          {seconds > 0 ? `Забрать награду через ${seconds}…` : 'Забрать награду'}
        </button>
        <button type="button" className="demo-ad-skip" onClick={() => finish(false)}>
          Закрыть без награды
        </button>
      </div>
    </div>,
    document.body,
  );
}
