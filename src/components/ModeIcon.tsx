import type { ModeIconName } from '../features/modes/modes';

/** Simple line pictograms for the game modes (24×24, stroked with currentColor). */
const PATHS: Record<ModeIconName, string[]> = {
  run: ['M14.5 4.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0', 'M12 8l-2.5 5 3.5 3-1 5', 'M9.5 13l-4 1.5', 'M12 8l4 3 3-1.5', 'M13 16l4 1'],
  infinity: ['M5 12c0-2 1.6-3.5 3.5-3.5 3.5 0 3.5 7 7 7 1.9 0 3.5-1.5 3.5-3.5s-1.6-3.5-3.5-3.5c-3.5 0-3.5 7-7 7C6.6 15.5 5 14 5 12z'],
  bolt: ['M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z'],
  stopwatch: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 13V9', 'M10 2h4', 'M18.5 6.5l1.5-1.5'],
  calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18', 'M8 3v4', 'M16 3v4', 'M8 14h3'],
  updown: ['M8 20V4', 'M5 7l3-3 3 3', 'M16 4v16', 'M13 17l3 3 3-3'],
  lanes: ['M4 12h16', 'M7.5 8.5L4 12l3.5 3.5', 'M16.5 8.5L20 12l-3.5 3.5', 'M12 4v3', 'M12 17v3'],
  heart: ['M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z'],
  target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 12h.01'],
  note: ['M9 18V5l11-2v13', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  notes: ['M7 17V6l6-1.5', 'M7 17a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0', 'M17 19V8l5-1', 'M17 19a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0'],
  duo: ['M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M16 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M2.5 20c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5', 'M10.5 20c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3 12h18', 'M12 3c2.8 2.6 2.8 15.4 0 18', 'M12 3c-2.8 2.6-2.8 15.4 0 18'],
  star: ['M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.6 6.7 19.5l1.1-6-4.4-4.2 6-.8L12 3z'],
  freeze: ['M12 3v18', 'M4.2 7.5l15.6 9', 'M4.2 16.5l15.6-9', 'M9.5 4.5L12 7l2.5-2.5', 'M9.5 19.5L12 17l2.5 2.5'],
  reflex: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12.8 8.5L10 13h3.2l-.9 3.8L15.2 12H12l.8-3.5z', 'M10 2h4'],
  squat: ['M13.8 4.6a1.8 1.8 0 1 1-3.6 0 1.8 1.8 0 0 1 3.6 0', 'M12 7.6l-1.2 5', 'M10.8 12.6l5 1.4-1.2 5.4', 'M12 9h5.5', 'M5 20.5h14'],
};

export function ModeIcon({ name, size = 28, className }: { name: ModeIconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
