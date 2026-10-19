import type { SVGProps } from 'react';

export type IconName =
  | 'heart'
  | 'coin'
  | 'lock'
  | 'arrowUp'
  | 'share'
  | 'bag'
  | 'trophy'
  | 'infinity'
  | 'shield'
  | 'snow'
  | 'undo'
  | 'bulb'
  | 'close'
  | 'back'
  | 'play'
  | 'crown'
  | 'spark'
  | 'users'
  | 'clock'
  | 'check'
  | 'star'
  | 'chevronRight'
  | 'plus'
  | 'flame';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

const FILLED = new Set<IconName>(['heart', 'coin', 'star', 'crown', 'flame', 'play', 'spark']);

export function Icon({ name, size = 20, filled, className, ...rest }: IconProps) {
  const isFilled = filled ?? FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill={isFilled ? 'currentColor' : 'none'}
      stroke={isFilled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {name === 'heart' && (
        <path d="M12 20.6c-.3 0-.6-.1-.8-.3C7.4 17 3.5 13.7 3.5 9.4 3.5 6.5 5.7 4.4 8.4 4.4c1.5 0 2.8.7 3.6 1.8.8-1.1 2.1-1.8 3.6-1.8 2.7 0 4.9 2.1 4.9 5 0 4.3-3.9 7.6-7.7 10.9-.2.2-.5.3-.8.3Z" />
      )}
      {name === 'coin' && (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <circle cx="12" cy="12" r="4.2" fill="#0b0d14" opacity=".35" />
          <path d="M12 8.4v7.2M10.2 10h2.4a1.2 1.2 0 0 1 0 2.4h-1.2a1.2 1.2 0 0 0 0 2.4h2.4" stroke="#0b0d14" strokeWidth="1.2" opacity=".5" />
        </>
      )}
      {name === 'lock' && (
        <>
          <rect x="4.8" y="10.2" width="14.4" height="9.4" rx="2.4" />
          <path d="M8.4 10V7.8a3.6 3.6 0 0 1 7.2 0V10M12 14v2.2" />
        </>
      )}
      {name === 'arrowUp' && <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />}
      {name === 'share' && (
        <>
          <circle cx="18" cy="5.6" r="2.4" />
          <circle cx="6" cy="12" r="2.4" />
          <circle cx="18" cy="18.4" r="2.4" />
          <path d="m8.2 10.9 7.6-4.1M8.2 13.1l7.6 4.1" />
        </>
      )}
      {name === 'bag' && (
        <>
          <path d="M5.2 8.4h13.6l-1 11H6.2l-1-11Z" />
          <path d="M8.8 8.2V6.8a3.2 3.2 0 0 1 6.4 0v1.4" />
          <path d="M9.2 12.2h5.6" />
        </>
      )}
      {name === 'trophy' && (
        <>
          <path d="M8 4.6h8v4.2a4 4 0 0 1-8 0V4.6Z" />
          <path d="M8 6H5.4v1.4A3.2 3.2 0 0 0 8.6 10.6M16 6h2.6v1.4a3.2 3.2 0 0 1-3.2 3.2M12 12.8v3.4M8.6 19.4h6.8M9.6 16.2h4.8v3.2H9.6z" />
        </>
      )}
      {name === 'infinity' && (
        <path d="M7.2 8.4c-2 0-3.6 1.6-3.6 3.6s1.6 3.6 3.6 3.6c2.6 0 3.4-2 4.8-3.6 1.4-1.6 2.2-3.6 4.8-3.6 2 0 3.6 1.6 3.6 3.6s-1.6 3.6-3.6 3.6c-2.6 0-3.4-2-4.8-3.6C10.6 10.4 9.8 8.4 7.2 8.4Z" />
      )}
      {name === 'shield' && (
        <path d="M12 3.4 19 6v5.6c0 4.4-2.9 7.4-7 9-4.1-1.6-7-4.6-7-9V6l7-2.6Z" />
      )}
      {name === 'snow' && (
        <>
          <path d="M12 3.8v16.4M4.9 7.9l14.2 8.2M19.1 7.9 4.9 16.1" />
          <path d="m9.6 5.2 2.4 2 2.4-2M9.6 18.8l2.4-2 2.4 2" />
        </>
      )}
      {name === 'undo' && (
        <>
          <path d="M8.2 7.2H4.6V3.6" />
          <path d="M4.9 7.1a8 8 0 1 1-1.1 7.8" />
        </>
      )}
      {name === 'bulb' && (
        <>
          <path d="M9.2 17.6a6.4 6.4 0 1 1 5.6 0v1.8a1.6 1.6 0 0 1-1.6 1.6h-2.4a1.6 1.6 0 0 1-1.6-1.6v-1.8Z" />
          <path d="M9.6 17.4h4.8M12 5.4v2" />
        </>
      )}
      {name === 'close' && <path d="m6 6 12 12M18 6 6 18" />}
      {name === 'back' && <path d="M19 12H5M11 6l-6 6 6 6" />}
      {name === 'play' && <path d="M8 5.6a.8.8 0 0 1 1.2-.7l9 6.4a.8.8 0 0 1 0 1.4l-9 6.4a.8.8 0 0 1-1.2-.7V5.6Z" />}
      {name === 'crown' && <path d="m3.4 7.6 4.3 3.1L12 4.4l4.3 6.3 4.3-3.1-1.4 9.3H4.8L3.4 7.6Zm2.1 11.2h13" />}
      {name === 'spark' && <path d="M12 2.8c.5 4.8 1.8 6.4 6.7 7.2-4.9.8-6.2 2.4-6.7 7.2-.5-4.8-1.8-6.4-6.7-7.2 4.9-.8 6.2-2.4 6.7-7.2Zm6.2 12.4c.2 2.2.8 2.9 3 3.3-2.2.4-2.8 1.1-3 3.3-.2-2.2-.8-2.9-3-3.3 2.2-.4 2.8-1.1 3-3.3Z" />}
      {name === 'users' && (
        <>
          <circle cx="9" cy="8.2" r="3" />
          <path d="M3.4 19.4v-1.2a4.4 4.4 0 0 1 4.4-4.4h2.4a4.4 4.4 0 0 1 4.4 4.4v1.2" />
          <path d="M15.4 5.5a3 3 0 0 1 0 5.5M16.8 14.2a4.4 4.4 0 0 1 3.8 4.4v.8" />
        </>
      )}
      {name === 'clock' && (
        <>
          <circle cx="12" cy="12" r="8.6" />
          <path d="M12 7.2V12l3.2 2" />
        </>
      )}
      {name === 'check' && <path d="m4.8 12.4 4.6 4.6L19.2 7" />}
      {name === 'star' && <path d="m12 3.2 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8L12 3.2Z" />}
      {name === 'chevronRight' && <path d="m9 5 7 7-7 7" />}
      {name === 'plus' && <path d="M12 5v14M5 12h14" />}
      {name === 'flame' && <path d="M12.2 2.8c.8 3.4-2.6 4.5-2.6 7.4 0 1.2.7 2.1 1.7 2.4-.2-1.9 1.3-3 2.5-4.1 1.9 1.8 3.4 3.7 3.4 6.1a5.2 5.2 0 0 1-10.4 0c0-3.2 2.4-5 5.4-11.8Z" />}
    </svg>
  );
}
