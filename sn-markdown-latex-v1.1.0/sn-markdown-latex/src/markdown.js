import { Marked } from 'marked';
import katex from 'katex';
import 'katex/contrib/mhchem'; // \ce{...} and \pu{...}
import DOMPurify from 'dompurify';

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function math(expression, display) {
  try {
    return katex.renderToString(expression, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
      macros: {},
    });
  } catch (_) {
    return `<code class="math-error">${escapeHtml(expression)}</code>`;
  }
}

/*
 * Math delimiters, in the order people actually write them:
 *   $...$   \(...\)            inline
 *   $$...$$ \[...\]            display
 *   \begin{align} ... \end{align}   (equation, gather, alignat too)
 * Dollar rules follow Pandoc, so "costs $5 and $10" stays plain text.
 */
const ENV = 'equation|align|gather|alignat';

const blockMath = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    const m = new RegExp(`\\n {0,3}(?:\\$\\$|\\\\\\[|\\\\begin\\{(?:${ENV})\\*?\\})`).exec(src);
    return m ? m.index + 1 : undefined;
  },
  tokenizer(src) {
    let m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
    if (m && m[1].trim()) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
    m = /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/.exec(src);
    if (m && m[1].trim()) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
    m = /^ {0,3}(\\begin\{(equation|align|gather|alignat)(\*?)\}[\s\S]+?\\end\{\2\3\})[ \t]*(?:\n+|$)/.exec(src);
    if (m) return { type: 'blockMath', raw: m[0], text: m[1] };
    return undefined;
  },
  renderer(token) {
    return `${math(token.text, true)}\n`;
  },
};

const BLANK_LINE = /\n[ \t]*\n/y;

/** Pandoc rule: opening $ not followed by space; closing $ not preceded by space nor followed by a digit. */
function matchDollar(src) {
  const first = src[1];
  if (src[0] !== '$' || first === undefined || first === '$' || /\s/.test(first)) return null;
  for (let i = 1; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '\n') {
      BLANK_LINE.lastIndex = i;
      if (BLANK_LINE.test(src)) return null;
    }
    if (c === '$') {
      if (/\s/.test(src[i - 1]) || /\d/.test(src[i + 1] || '')) return null;
      return { raw: src.slice(0, i + 1), text: src.slice(1, i) };
    }
  }
  return null;
}

const inlineMath = {
  name: 'inlineMath',
  level: 'inline',
  start(src) {
    const i = src.search(/\$|\\[(\[]/);
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    let m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m && m[1].trim()) return { type: 'inlineMath', raw: m[0], text: m[1].trim(), display: true };
    m = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (m && m[1].trim()) return { type: 'inlineMath', raw: m[0], text: m[1].trim(), display: false };
    m = /^\\\[([\s\S]+?)\\\]/.exec(src);
    if (m && m[1].trim()) return { type: 'inlineMath', raw: m[0], text: m[1].trim(), display: true };
    const d = matchDollar(src);
    if (d && d.text.trim()) return { type: 'inlineMath', raw: d.raw, text: d.text, display: false };
    return undefined;
  },
  renderer(token) {
    return math(token.text, token.display);
  },
};

const marked = new Marked({ gfm: true, breaks: false });
marked.use({ extensions: [blockMath, inlineMath] });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href');
    if (href && href.charAt(0) !== '#') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  } else if (node.tagName === 'IMG') {
    node.setAttribute('loading', 'lazy');
    node.setAttribute('decoding', 'async');
    node.setAttribute('referrerpolicy', 'no-referrer');
  }
});

export function renderMarkdown(text) {
  try {
    return DOMPurify.sanitize(marked.parse(text), {
      ADD_TAGS: ['semantics', 'annotation'],
      ADD_ATTR: ['encoding'],
    });
  } catch (_) {
    return `<pre>${escapeHtml(text)}</pre>`;
  }
}
