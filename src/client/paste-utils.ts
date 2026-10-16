/**
 * Reduces a rich-text clipboard payload (Excel/Sheets tables, Word/Docs
 * content, copied web pages) to the structured HTML worth attaching:
 * strips comments and MS Office noise, and for tabular pastes keeps just
 * the table markup — the part the Dot actually needs to read the data.
 */
export function cleanClipboardHtml(html: string, isTable: boolean): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(o:|w:|v:|m:)[^>]*>/g, '')
    .replace(/\s(?:class|id|width|height|style|colspan)="[^"]*"/gi, (m) =>
      /colspan=/i.test(m) ? m : '',
    );
  if (isTable) {
    const table = out.match(/<table[\s\S]*?<\/table>/i);
    if (table) out = table[0];
  }
  return out.slice(0, 60000);
}

/**
 * Decides whether a pasted rich-text payload is worth attaching as a
 * structured HTML file: tabular pastes always are, and doc-sized markup
 * is; a single formatted word is not.
 */
export function isRichClipboardHtml(html: string): boolean {
  if (!html) return false;
  if (/<table[\s>]/i.test(html)) return true;
  return html.length > 1000 && /<(p|div|span|h\d|li|table|tr)\b/i.test(html);
}
