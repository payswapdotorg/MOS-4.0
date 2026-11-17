import type { NicheDefinition } from "./niche.js";

/**
 * Workflow C — AI search-theme expansion, with a guaranteed non-LLM path.
 *
 * The LLM expander (wired to the app's model client in a later stage) must
 * produce themes the user can inspect, edit, and approve before research.
 * When no LLM is available, `deriveThemesFromNiche` gives a usable manual
 * workflow from deterministic keyword templates — never a broken screen.
 */

export interface SearchTheme {
  id: string;
  text: string;
  rationale?: string;
}

export interface ThemeExpansion {
  themes: SearchTheme[];
  source: "llm" | "manual" | "derived";
}

export interface ThemeExpander {
  expand(niche: NicheDefinition): Promise<ThemeExpansion>;
}

const STOPWORDS = new Set([
  "a", "an", "the", "for", "of", "in", "on", "with", "and", "or", "to", "at",
  "by", "from", "up", "about", "into", "over", "after", "best", "top", "how",
  "my", "your",
]);

function keywords(niche: NicheDefinition): string[] {
  return niche.description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token))
    .slice(0, 8);
}

function themeId(text: string, index: number): string {
  return `theme-${index + 1}-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
}

/**
 * Deterministic fallback themes from the niche text. Templates are ordinary
 * YouTube search phrasings; the full niche description always stays first so
 * the user's own words drive the primary search.
 */
export function deriveThemesFromNiche(niche: NicheDefinition): ThemeExpansion {
  const description = niche.description.trim();
  const words = keywords(niche);
  const core = words.slice(0, 5).join(" ");
  const themes: string[] = [description];
  if (core && core !== description.toLowerCase()) {
    themes.push(core);
  }
  themes.push(`${description} for beginners`);
  themes.push(`${description} routine`);
  themes.push(`${core || description} tips`);
  themes.push(`${core || description} mistakes`);
  return {
    source: "derived",
    themes: [...new Set(themes)].slice(0, 7).map((text, index) => ({
      id: themeId(text, index),
      text,
      rationale: index === 0 ? "Your niche description as entered." : "Deterministic expansion (no model available).",
    })),
  };
}

/** Manual workflow: the user types the themes themselves. */
export class ManualThemeExpander implements ThemeExpander {
  async expand(niche: NicheDefinition): Promise<ThemeExpansion> {
    void niche;
    return { themes: [], source: "manual" };
  }
}
