/** Markdown AST shared by parser and renderer (FR-15 GFM full-spec). Pure TS. */

export type Align = "left" | "center" | "right" | null;

export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "del"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type ListItem = {
  inline: Inline[];
  /** null = not a checkbox item; true/false = checkbox state. */
  checked: boolean | null;
  children: Block[];
};

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "code"; lang: string | null; text: string; loading: boolean }
  | { type: "blockquote"; children: Block[] }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: ListItem[] }
  | { type: "table"; header: Inline[][]; align: Align[]; rows: Inline[][][] };
