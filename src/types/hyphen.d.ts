// Minimal type declarations for the `hyphen` package.
// The package is pure-CJS without published .d.ts files. We use it to
// insert soft hyphens (\u00AD) into body text for print typography.

declare module "hyphen" {
  type HyphenateFn = (text: string) => string;
  type Patterns = {
    leftMin: number;
    rightMin: number;
    patterns: Record<string, string>;
    exceptions?: string[];
  };
  type Options = {
    hyphenChar?: string;
    minWordLength?: number;
    html?: boolean;
    debug?: boolean;
    async?: boolean;
  };
  function createHyphenator(patterns: Patterns, options?: Options): HyphenateFn;
  export default createHyphenator;
}

declare module "hyphen/patterns/en-us" {
  const patterns: {
    leftMin: number;
    rightMin: number;
    patterns: Record<string, string>;
    exceptions?: string[];
  };
  export default patterns;
}

declare module "hyphen/patterns/hi" {
  const patterns: {
    leftMin: number;
    rightMin: number;
    patterns: Record<string, string>;
    exceptions?: string[];
  };
  export default patterns;
}
