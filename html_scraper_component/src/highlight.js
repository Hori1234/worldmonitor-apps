/**
 * Thin syntax-highlighting wrapper around highlight.js.
 * Registers only the languages we need to keep the bundle small.
 */
import hljs from 'highlight.js/lib/core';
import langJson        from 'highlight.js/lib/languages/json';
import langBash        from 'highlight.js/lib/languages/bash';
import langPowershell  from 'highlight.js/lib/languages/powershell';

hljs.registerLanguage('json',       langJson);
hljs.registerLanguage('bash',       langBash);
hljs.registerLanguage('powershell', langPowershell);

/**
 * Return an HTML string with highlight.js markup.
 * @param {string} code
 * @param {'json'|'bash'|'powershell'} lang
 */
export function hl(code, lang) {
  if (!code.trim()) return '';
  return hljs.highlight(code, { language: lang }).value;
}
