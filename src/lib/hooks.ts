import { useEffect, useRef, useState } from 'react';

export function useNow(intervalMs = 1000, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

export function useCountdown(target: number | null, onExpire?: () => void): number {
  const now = useNow(1000, Boolean(target));
  const remaining = target ? Math.max(0, target - now) : 0;
  const fired = useRef(false);
  const targetRef = useRef(target);

  useEffect(() => {
    if (targetRef.current !== target) {
      targetRef.current = target;
      fired.current = false;
    }
    if (target && remaining <= 0 && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [remaining, target, onExpire]);

  return remaining;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
