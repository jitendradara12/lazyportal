import type { ComponentType } from "react";

export interface NavItem {
  id: string;
  label: string;
  Icon: ComponentType;
  badge?: number;
}

/** Material 3 bottom navigation bar: pill indicator behind the icon, label below. */
export function NavigationBar({ items, active, onSelect }: { items: NavItem[]; active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="nav-bar" aria-label="Main">
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
