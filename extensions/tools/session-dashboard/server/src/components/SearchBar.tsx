// src/components/SearchBar.tsx
export interface SearchBarProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Filter by cwd, name, or preview…",
}: SearchBarProps): JSX.Element {
  return (
    <div className="search-bar">
      <input
        className="search-input"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label="filter sessions"
      />
      {value ? (
        <button
          className="search-clear"
          type="button"
          onClick={() => onChange("")}
          aria-label="clear filter"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
