const PATHS = {
  home: 'M3.5 10.2 12 3.5l8.5 6.7V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z',
  calendar:
    'M6.5 4.5h11a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-10a3 3 0 0 1 3-3zM3.5 9.5h17M8 2.8v3.4M16 2.8v3.4',
  plus: 'M12 5v14M5 12h14',
  trend: 'M3.5 17.5l5.5-5.5 4 4 7.5-7.5M15 8.5h5.5V14',
  body: 'M8 3.5h8a4.5 4.5 0 0 1 4.5 4.5v8a4.5 4.5 0 0 1-4.5 4.5H8A4.5 4.5 0 0 1 3.5 16V8A4.5 4.5 0 0 1 8 3.5zM7.5 10a6 6 0 0 1 9 0M12 10.5l1.6-2.4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  video:
    'M5 6h8a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 5 6zM15.5 10.5 21 7.5v9l-5.5-3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'chevron-left': 'M15 5.5 8.5 12l6.5 6.5',
  'chevron-right': 'M9 5.5l6.5 6.5L9 18.5',
  'chevron-down': 'M6 9l6 6 6-6',
  trophy:
    'M8 4h8v5.5a4 4 0 0 1-8 0zM8 6H5.5a3 3 0 0 0 3 4M16 6h2.5a3 3 0 0 1-3 4M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z',
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2',
  timer: 'M12 21a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 9.5v4l2.5 2M9.5 2.5h5',
  up: 'M12 19V5.5M6.5 11 12 5.5 17.5 11',
  down: 'M12 5v13.5M6.5 13l5.5 5.5 5.5-5.5',
  expand: 'M8 3.5H3.5V8M16 3.5h4.5V8M8 20.5H3.5V16M16 20.5h4.5V16',
  pulse: 'M3 12.5h4l2.5-6.5 5 13 2.5-6.5h4',
} as const;

const FILLED = {
  play: 'M8 5.5v13l10.5-6.5z',
} as const;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  const filledPath = (FILLED as Record<string, string>)[name];
  return (
    <svg
      className={`pulse-icon ${filled || filledPath ? 'filled' : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={filledPath ?? (PATHS as Record<string, string>)[name]} />
    </svg>
  );
}
