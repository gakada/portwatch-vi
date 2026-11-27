// The owner's pinned message under the countdown. It comes from data/pinned.json, a static file like
// tracker.json, so it costs no database calls however many people visit. The owner edits it from the
// private dashboard (dashboard/pinned-editor.js), which commits the file through GitHub's API.
// Shared by the homepage (app.js) and the dashboard's live preview.

export const PINNED_MAX = 500;
const AVATAR_RE = /^assets\/img\/[\w/.-]+\.(png|jpe?g|webp|svg)$/;

// An optional GIF under the text (`gif` in pinned.json): a file in this repo under assets/img/pinned/
// (the dashboard uploads it there), or an https link straight to the image on Giphy, Tenor or Imgur.
const GIF_LOCAL_RE = /^assets\/img\/pinned\/[\w.-]+\.(gif|webp|png|jpe?g)$/i;
const GIF_HOST_RE = /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\d*\.tenor\.com|c\.tenor\.com|i\.imgur\.com)\/[^\s"'<>]+$/i;
export const pinnedGif = (g) => (GIF_LOCAL_RE.test(g || '') || GIF_HOST_RE.test(g || '') ? g : null);

// What the owner pastes, made into something pinnedGif accepts: a Giphy page or embed link becomes
// its GIF file; anything else is returned trimmed (and rejected by pinnedGif if it isn't allowed).
export function gifFromLink(s) {
  const v = String(s || '').trim();
  const giphy = v.match(/^https:\/\/(?:www\.)?giphy\.com\/(?:gifs|embed|stickers)\/(?:[\w-]*-)?([A-Za-z0-9]{6,})\/?(?:[?#].*)?$/);
  return giphy ? `https://media.giphy.com/media/${giphy[1]}/giphy.gif` : v;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

// An optional call-out under the message (`cta` in pinned.json), e.g. where to send build submissions:
// { "title", "text", "label", "url" }. `text` takes **bold** like the message; the button needs a
// label and an https link. Returns null when it can't be shown.
export function pinnedCta(c) {
  const url = String(c?.url ?? '').trim();
  const label = String(c?.label ?? '').trim().slice(0, 40);
  if (!label || !/^https:\/\/[^\s"'<>]+$/i.test(url)) return null;
  return { title: String(c.title ?? '').trim().slice(0, 40), text: String(c.text ?? '').trim().slice(0, 240), label, url };
}

// Plain text with line breaks; https links become links. Everything else is escaped.
export function linkify(text) {
  return String(text).split(/(https:\/\/[^\s<>"']+)/g).map((part, i) => {
    if (i % 2 === 0) return bold(part);
    const url = part.replace(/[.,;:!?)\]]+$/, '');
    const shown = url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');
    return `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(shown.length > 42 ? `${shown.slice(0, 40)}…` : shown)}</a>${esc(part.slice(url.length))}`;
  }).join('');
}

// Fills the .pinned card inside `box` and shows it. Returns false (card stays hidden) when there's nothing to pin.
// `base` prefixes local paths, for pages outside the site root (the dashboard passes '../').
// `gifSrc` lets the dashboard preview a GIF that isn't on the site yet (a just-picked file).
export function fillPinned(box, p, { ago = () => '', when = (iso) => new Date(iso).toLocaleString(), base = '', gifSrc = '' } = {}) {
  const text = String(p?.text ?? '').trim().slice(0, PINNED_MAX);
  const gif = pinnedGif(p?.gif);
  const cta = pinnedCta(p?.cta);
  if (!box || !p || p.show === false || (!text && !gif && !cta)) { if (box) box.hidden = true; return false; }

  const name = String(p.name || '4lwayz').slice(0, 40);
  box.querySelector('.pin-name').textContent = name;

  const av = box.querySelector('.pin-avatar');
  av.querySelector('b').textContent = ([...name][0] || '?').toUpperCase();
  av.querySelector('img')?.remove();
  if (AVATAR_RE.test(p.avatar || '')) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.onerror = () => img.remove(); // the letter underneath shows instead
    img.src = base + p.avatar;
    av.prepend(img);
  }

  const textEl = box.querySelector('.pin-text');
  textEl.innerHTML = linkify(text);
  textEl.hidden = !text;
  textEl.parentElement.querySelector('.pin-gif')?.remove();
  if (gif) {
    const img = new Image();
    img.className = 'pin-gif';
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer'; // Giphy and the like don't learn which page it's on
    img.onerror = () => img.remove();
    img.src = gifSrc || (gif.startsWith('assets/') ? base + gif : gif);
    textEl.after(img);
  }

  textEl.parentElement.querySelector('.pin-cta')?.remove();
  if (cta) {
    const el = document.createElement('div');
    el.className = 'pin-cta';
    const host = cta.url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');
    el.innerHTML = `${cta.title ? `<p class="pin-cta-title"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6.6L8 21v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm4 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>${esc(cta.title)}</p>` : ''}`
      + `${cta.text ? `<p class="pin-cta-text">${bold(cta.text)}</p>` : ''}`
      + `<a class="pin-cta-btn" href="${esc(cta.url)}" target="_blank" rel="noopener nofollow"><span><b>${esc(cta.label)}</b><small>${esc(host.length > 42 ? `${host.slice(0, 40)}…` : host)}</small></span>`
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>';
    (textEl.parentElement.querySelector('.pin-gif') || textEl).after(el);
  }

  const time = box.querySelector('.pin-time');
  const ok = Number.isFinite(Date.parse(p.updated));
  time.hidden = !ok;
  if (ok) {
    time.dateTime = p.updated;
    time.textContent = ago(p.updated);
    time.title = when(p.updated);
  }
  box.hidden = false;
  return true;
}
