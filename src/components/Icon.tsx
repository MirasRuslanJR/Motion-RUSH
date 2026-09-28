import type { Arrow } from '../features/gestures/types';

type IconName = Arrow | 'check' | 'cross' | 'camera' | 'sound' | 'mute' | 'bolt' | 'person' | 'sun' | 'users' | 'ruler' | 'chip';

const PATHS: Record<IconName, string> = {
  up: 'M12 19V5m0 0-6 6m6-6 6 6',
  down: 'M12 5v14m0 0 6-6m-6 6-6-6',
  left: 'M19 12H5m0 0 6 6m-6-6 6-6',
  right: 'M5 12h14m0 0-6-6m6 6-6 6',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  cross: 'M6 6l12 12M18 6 6 18',
  camera: 'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  sound: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5m0-5-5 5',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6z',
  person: 'M12 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M7 21l1.5-8L6 10l3-1.5h6l3 1.5-2.5 3L17 21M9 13h6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6m7 0a2.5 2.5 0 1 0 0-5M3 20a6 6 0 0 1 12 0m2-4.5a5 5 0 0 1 4 4.5',
  ruler: 'M3 16.5 16.5 3 21 7.5 7.5 21zM7 12.5l1.5 1.5M10 9.5l1.5 1.5M13 6.5l1.5 1.5',
  chip: 'M8 4v2m4-2v2m4-2v2M8 18v2m4-2v2m4-2v2M4 8h2m-2 4h2m-2 4h2m12-8h2m-2 4h2m-2 4h2M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1',
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
