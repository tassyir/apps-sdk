/**
 * Escaping for text and double-quoted attribute values. Every character that
 * can start markup, end a value or start a character reference is escaped, in
 * both places, so one function serves both.
 */
export function escapeHtml(text: string): string {
  let out = '';
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    let entity: string;
    switch (text.charCodeAt(i)) {
      case 38:
        entity = '&amp;';
        break;
      case 60:
        entity = '&lt;';
        break;
      case 62:
        entity = '&gt;';
        break;
      case 34:
        entity = '&quot;';
        break;
      case 39:
        entity = '&#39;';
        break;
      default:
        continue;
    }
    out += text.slice(from, i) + entity;
    from = i + 1;
  }
  return from === 0 ? text : out + text.slice(from);
}
