import type { ComponentType } from "react";

export interface NavItem {
  id: string;
  label: string;
  Icon: ComponentType;
  badge?: number;
}

/** Bottom navigation on mobile, persistent sidebar on desktop. */
export function NavigationBar({ items, active, onSelect }: { items: NavItem[]; active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="nav-bar" aria-label="Main">
      <div className="nav-brand">Lazyportal</div>
      {items.map(({ id, label, Icon, badge }) => (
        <button
          key={id}
          type="button"
          className="nav-item"
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <span className="nav-indicator">
            <Icon />
            {badge ? <span className="nav-badge" aria-label={`${badge} short`}>{badge}</span> : null}
          </span>
          <span className="nav-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
