import type { ReactNode } from 'react';

export function CachedTabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div className="cached-tab-panel" hidden={!active}>
      {children}
    </div>
  );
}
