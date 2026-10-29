// src/components/FilterBar.tsx
// Inline pill strip that toggles which entries render in SessionView.
// Controlled component: parent owns the Filters state.

import type { JSX } from "react";
import type { Filters, RoleFilter } from "../lib/filters";
import { toggleHideDividers, toggleRole, toggleThinking } from "../lib/filters";

export interface FilterBarProps {
  filters: Filters;
  onChange: (next: Filters) => void;
}

interface RolePillConfig {
  role: RoleFilter;
  label: string;
}

const ROLE_PILLS: RolePillConfig[] = [
  { role: "user", label: "user" },
  { role: "assistant", label: "assistant" },
  { role: "toolResult", label: "tool" },
  { role: "bashExecution", label: "bash" },
  { role: "customMessage", label: "custom" },
];

export function FilterBar({ filters, onChange }: FilterBarProps): JSX.Element {
  return (
    <div className="filter-bar" role="toolbar" aria-label="entry filters">
      <div className="filter-bar-roles">
        {ROLE_PILLS.map(({ role, label }) => {
          const checked = filters.showRoles[role];
          return (
            <button
              key={role}
              type="button"
              className="filter-pill"
              aria-pressed={checked}
              data-role={role}
              onClick={() => onChange(toggleRole(filters, role))}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="filter-bar-divider" aria-hidden="true" />
      <button
        type="button"
        className="filter-pill filter-pill-bundle"
        aria-pressed={filters.showThinking}
        data-filter="showThinking"
        onClick={() => onChange(toggleThinking(filters))}
        title="Toggle visibility of thinking blocks inside assistant messages"
      >
        {filters.showThinking ? "thinking shown" : "thinking hidden"}
      </button>
      <button
        type="button"
        className="filter-pill filter-pill-bundle"
        aria-pressed={filters.hideDividers}
        data-filter="hideDividers"
        onClick={() => onChange(toggleHideDividers(filters))}
        title="Toggle visibility of model change, thinking level, compaction, and branch summary entries"
      >
        {filters.hideDividers ? "dividers hidden" : "dividers shown"}
      </button>
    </div>
  );
}