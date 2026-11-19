/* Applies the theme stylesheets Standard Notes hands to the plugin. */

const links = new Map(); // url -> <link>
const FOCUS_LOCAL = '/org.standardnotes.theme-focus/index.css';
const FOCUS_WEB = 'https://app.standardnotes.com/components/assets/org.standardnotes.theme-focus/index.css';

/** Tell the browser whether the active theme is dark (scrollbars, caret, form controls). */
export function syncColorScheme() {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(getComputedStyle(document.body).backgroundColor);
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return;
  const luminance = (0.2126 * Number(m[1]) + 0.7152 * Number(m[2]) + 0.0722 * Number(m[3])) / 255;
  document.documentElement.style.colorScheme = luminance < 0.5 ? 'dark' : 'light';
}

export function applyThemes(urls) {
  const wanted = new Set();
  for (const raw of urls || []) {
    if (raw) wanted.add(raw.endsWith(FOCUS_LOCAL) ? FOCUS_WEB : raw);
  }
  for (const [url, link] of links) {
    if (!wanted.has(url)) {
      link.remove();
      links.delete(url);
    }
  }
  for (const url of wanted) {
    if (links.has(url)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.media = 'screen,print';
    link.className = 'custom-theme';
    link.addEventListener('load', syncColorScheme);
    document.head.appendChild(link);
    links.set(url, link);
  }
  syncColorScheme();
}
