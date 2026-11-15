"use client";

import MoonScene from "../canvas/MoonScene";

type MoonPortalProps = { compact?: boolean; label?: string };

export default function MoonPortal({ compact = false, label }: MoonPortalProps) {
  return (
    <div className={compact ? "moon-portal moon-portal-compact" : "moon-portal"}>
      {label && <span className="moon-portal-label">{label}</span>}
      <MoonScene compact={compact} />
    </div>
  );
}