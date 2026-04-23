import React from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";

/**
 * Compact search input with a `⌘F` kbd hint, used at the top of
 * `<ArticleHistoryPanel>`. Filters the snapshot list by label substring.
 */
export interface SearchInputProps {
  value: string;
  onChange: (next: string) => void;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ value, onChange }, ref): React.ReactElement {
    return (
      <div className="border-border-default focus-within:border-accent relative flex items-center rounded-md border bg-white">
        <MagnifyingGlass size={14} className="text-text-tertiary ml-2" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Find a version..."
          data-testid="article-history-search"
          className="text-body text-text-primary placeholder:text-text-tertiary flex-1 bg-transparent px-2 py-1.5 focus:outline-none"
        />
        <kbd className="border-border-default text-text-tertiary mr-2 rounded-sm border px-1.5 py-0.5 text-[10px]">
          ⌘F
        </kbd>
      </div>
    );
  }
);
