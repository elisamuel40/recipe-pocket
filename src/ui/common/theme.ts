/** Applies theme and font-scale preferences to the current extension page. */
import type { Preferences } from '../../shared/types';

export function applyPreferences(p: Pick<Preferences, 'theme' | 'fontScale'>): void {
  const root = document.documentElement;
  if (p.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', p.theme);
  const scale = Math.min(2.5, Math.max(0.8, p.fontScale || 1));
  root.style.setProperty('--font-scale', String(scale));
}
