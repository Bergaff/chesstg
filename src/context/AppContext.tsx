import { createContext, useContext } from 'react';
import type { ActiveRuns, AppConfig, Challenge, Profile } from '../lib/types';
import type { ToastKind } from '../components/Toast';

export type ShopTab = 'bonuses' | 'skins' | 'stars';

export interface AppContextValue {
  profile: Profile;
  config: AppConfig;
  active: ActiveRuns;
  invitedCount: number;
  challenge: Challenge | null;
  setProfile: (profile: Profile) => void;
  refresh: () => Promise<void>;
  toast: (message: string, kind?: ToastKind) => void;
  showAd: (label: string) => Promise<boolean>;
  goMenu: () => void;
  goShop: () => void;
  goShopStars: () => void;
  goRecords: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('AppContext is not available');
  return value;
}
