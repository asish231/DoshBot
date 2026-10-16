import { describe, expect, it } from 'vitest';
import {
  cleanClipboardHtml,
  isRichClipboardHtml,
} from '../src/client/paste-utils.js';

const excelPaste = `<!--table-->
<html xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"></head>
<body>
<p class="MsoNormal"><span style="color:red">Quarterly numbers</span></p>
<table border="0" cellpadding="0" width="300">
  <tr><td height="20">Region</td><td>Q3</td></tr>
  <tr><td>North</td><td>1,204</td></tr>
  <tr><td>South</td><td>980</td></tr>
</table>
<p>Prepared by finance</p>
</body>
</html>`;

describe('isRichClipboardHtml', () => {
  it('captures tabular pastes from Excel/Sheets', () => {
    expect(isRichClipboardHtml(excelPaste)).toBe(true);
    expect(isRichClipboardHtml('<table><tr><td>a</td></tr></table>')).toBe(
      true,
    );
  });

  it('captures doc-sized markup', () => {
    const docHtml = `<p>${'word '.repeat(250)}</p>`;
    expect(isRichClipboardHtml(docHtml)).toBe(true);
  });

  it('ignores trivial formatted snippets', () => {
    expect(isRichClipboardHtml('<b>hi</b>')).toBe(false);
    expect(isRichClipboardHtml('<span style="x">one word</span>')).toBe(false);
    expect(isRichClipboardHtml('')).toBe(false);
  });
});

describe('cleanClipboardHtml', () => {
  it('keeps only the table for tabular pastes, dropping Office noise', () => {
    const out = cleanClipboardHtml(excelPaste, true);
    expect(out.toLowerCase()).toContain('<table');
    expect(out).toContain('North');
    expect(out).not.toContain('MsoNormal');
    expect(out).not.toContain('finance');
    expect(out).not.toContain('<!--');
    expect(out).not.toMatch(/<(o|w|v|m):/);
  });

  it('preserves colspan so merged cells still read correctly', () => {
    const out = cleanClipboardHtml(
      '<table><tr><td colspan="2">merged</td></tr></table>',
      true,
    );
    expect(out).toContain('colspan="2"');
  });

  it('keeps doc content (not just tables) for non-tabular pastes', () => {
    const doc = '<p>hello world</p><ul><li>one</li><li>two</li></ul>';
    const out = cleanClipboardHtml(doc, false);
    expect(out).toBe(doc);
  });

  it('falls back to the full markup when no table tag is present', () => {
    const out = cleanClipboardHtml('<p>data</p>', true);
    expect(out).toBe('<p>data</p>');
  });

  it('caps output at 60KB', () => {
    const huge = `<p>${'x'.repeat(200_000)}</p>`;
    expect(cleanClipboardHtml(huge, false).length).toBe(60000);
  });
});
