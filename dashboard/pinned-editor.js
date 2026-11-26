// Pinned message editor for the private dashboard. It doesn't need the Supabase sign-in, so it still works
// when the database is down: the message is a static file, data/pinned.json, and publishing commits that
// file to main through GitHub's API. The deploy workflow then puts it live in about two minutes.
// Publishing needs the owner's fine-grained GitHub token (this repo only, Contents: read and write),
// kept in this browser's localStorage on this PC. It's sent only to api.github.com.
import { fillPinned, PINNED_MAX, pinnedGif, gifFromLink } from '../assets/js/pinned.js';

const REPO = '4lwayz/portwatch-vi';
const FILE = 'data/pinned.json';
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
const TOKEN_KEY = 'pw-gh-token';
const DEFAULTS = { show: false, name: '4lwayz', avatar: 'assets/img/4lwayz-2.jpg', text: '', updated: null };

const $ = (s) => document.querySelector(s);
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

let current = { ...DEFAULTS }; // the file as last loaded or published
let sha = null; // its blob sha on main, needed to update it
let busy = false;
let gif = ''; // the GIF under the message: a link, or assets/img/pinned/… once a file is uploaded
let uploaded = { path: '', url: '' }; // a file uploaded this session: shown from this PC until the site has it
const GIF_MAX = 8 * 1024 * 1024;

const token = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const note = (html, kind = '') => { const el = $('#pin-note'); el.className = `fine pin-note ${kind}`; el.innerHTML = html; };

const b64encode = (str) => { let bin = ''; for (const b of new TextEncoder().encode(str)) bin += String.fromCharCode(b); return btoa(bin); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function gh(method = 'GET', body, api = API) {
  return fetch(method === 'GET' ? `${api}?ref=main` : api, {
    method,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function ghError(res) {
  if (res.status === 401) return 'GitHub rejected the token. It may have expired: make a new one below.';
  if (res.status === 403 || res.status === 404) return `The token can't write to ${REPO}. It needs this repository and Contents: read and write.`;
  return `GitHub answered HTTP ${res.status}.`;
}

// The current file: from GitHub when there's a token (always up to date), else from this checkout.
async function load() {
  if (token()) {
    const res = await gh();
    if (res.status === 404) { sha = null; return { ...DEFAULTS }; }
    if (!res.ok) throw new Error(ghError(res));
    const j = await res.json();
    sha = j.sha;
    return { ...DEFAULTS, ...JSON.parse(b64decode(j.content)) };
  }
  const res = await fetch(`../${FILE}?ts=${Date.now()}`, { cache: 'no-store' });
  return res.ok ? { ...DEFAULTS, ...(await res.json()) } : { ...DEFAULTS };
}

function showState() {
  const live = current.show !== false && String(current.text || '').trim();
  const pill = $('#pin-state');
  pill.textContent = live ? 'Live' : 'Not shown';
  pill.classList.toggle('is-off', !live);
}

function preview() {
  const text = $('#pin-input').value;
  $('#pin-chars').textContent = `${text.length}/${PINNED_MAX}`;
  const gifSrc = gif && gif === uploaded.path ? uploaded.url : '';
  const shown = fillPinned($('#pin-preview .pinned'), { ...current, show: true, text, gif, updated: new Date().toISOString() }, { ago, base: '../', gifSrc });
  $('#pin-empty').hidden = shown;
  $('#pin-gif-clear').hidden = !gif;
}

// The GIF box: Giphy page links become the GIF itself; other links must point straight at a GIF.
function setGif(value) {
  gif = gifFromLink(value);
  $('#pin-gif').value = gif;
  if (gif && !pinnedGif(gif)) note('That link isn\'t a GIF from Giphy, Tenor or Imgur. On Tenor or Imgur, right-click the GIF and copy the image address.', 'is-bad');
  preview();
}

const fileBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// Uploads a GIF from this PC to assets/img/pinned/ on main (a commit of its own), then uses it.
async function uploadGif(file) {
  if (!file || busy) return;
  if (!token()) { $('#pin-token-box').open = true; note('Add your GitHub token first (below).', 'is-bad'); return; }
  const ext = (file.name.match(/\.(gif|webp|png|jpe?g)$/i)?.[1] || '').toLowerCase();
  if (!ext) { note('Pick a .gif, .webp, .png or .jpg file.', 'is-bad'); return; }
  if (file.size > GIF_MAX) { note(`That file is ${(file.size / 1048576).toFixed(1)} MB; the limit is 8 MB.`, 'is-bad'); return; }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-');
  const slug = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'gif';
  const path = `assets/img/pinned/${stamp}-${slug}.${ext}`;
  busy = true;
  $('#pin-form').classList.add('is-busy');
  note('Uploading the GIF…');
  try {
    const res = await gh('PUT', { message: `Pinned GIF: ${slug}.${ext}`, content: await fileBase64(file), branch: 'main' }, `https://api.github.com/repos/${REPO}/contents/${path}`);
    if (!res.ok) throw new Error(ghError(res));
    if (uploaded.url) URL.revokeObjectURL(uploaded.url);
    uploaded = { path, url: URL.createObjectURL(file) };
    setGif(path);
    note('GIF uploaded. Publish to pin it under the message.', 'is-ok');
  } catch (err) {
    note(String(err.message || err), 'is-bad');
  } finally {
    busy = false;
    $('#pin-form').classList.remove('is-busy');
    $('#pin-gif-file').value = '';
  }
}

async function publish(show) {
  if (busy) return;
  if (!token()) { $('#pin-token-box').open = true; $('#pin-token').focus(); note('Add your GitHub token first (below).', 'is-bad'); return; }
  const text = $('#pin-input').value.trim();
  if (show && gif && !pinnedGif(gif)) { note('Fix or remove the GIF link first.', 'is-bad'); return; }
  if (show && !text && !gif) { note('Write a message or add a GIF first.', 'is-bad'); return; }

  const next = {
    show,
    name: current.name || DEFAULTS.name,
    avatar: current.avatar || DEFAULTS.avatar,
    text: show ? text : current.text || text,
    ...((show ? gif : current.gif) ? { gif: show ? gif : current.gif } : {}),
    updated: show ? new Date().toISOString().replace(/\.\d+Z$/, 'Z') : current.updated,
  };
  const oneLine = next.text.replace(/\s+/g, ' ');
  const body = {
    message: show ? `Pinned message: "${oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine}"` : 'Pinned message: taken down',
    content: b64encode(`${JSON.stringify(next, null, 2)}\n`),
    branch: 'main',
  };

  busy = true;
  $('#pin-form').classList.add('is-busy');
  note(show ? 'Publishing…' : 'Taking it down…');
  try {
    if (!sha) await load().catch(() => {}); // pick up the sha if the file exists
    let res = await gh('PUT', sha ? { ...body, sha } : body);
    if (res.status === 409 || res.status === 422) { // changed on GitHub since it was loaded: reload the sha, try once more
      await load();
      res = await gh('PUT', sha ? { ...body, sha } : body);
    }
    if (!res.ok) throw new Error(ghError(res));
    const j = await res.json();
    sha = j.content?.sha || null;
    current = next;
    showState();
    const url = String(j.commit?.html_url || '');
    const commit = url.startsWith(`https://github.com/${REPO}/`) ? ` <a href="${encodeURI(url)}" target="_blank" rel="noopener">See the commit</a>.` : '';
    note(show ? `Published. The site shows it in about 2 minutes, once the deploy finishes.${commit}` : `Taken down. It leaves the site in about 2 minutes.${commit}`, 'is-ok');
  } catch (err) {
    note(String(err.message || err), 'is-bad');
  } finally {
    busy = false;
    $('#pin-form').classList.remove('is-busy');
  }
}

function bindToken() {
  const box = $('#pin-token-box');
  const refresh = () => {
    const has = Boolean(token());
    $('#pin-token-state').textContent = has ? 'saved on this PC' : 'not set';
    $('#pin-token-forget').hidden = !has;
    if (!has) box.open = true;
  };
  $('#pin-token-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const v = $('#pin-token').value.trim();
    if (!v) return;
    try { localStorage.setItem(TOKEN_KEY, v); } catch { note("This browser won't store the token.", 'is-bad'); return; }
    $('#pin-token').value = '';
    refresh();
    try { current = await load(); showState(); note('Token saved. Loaded the current message from GitHub.', 'is-ok'); box.open = false; } catch (err) { note(String(err.message || err), 'is-bad'); }
  });
  $('#pin-token-forget').addEventListener('click', () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} sha = null; refresh(); note('Token removed from this browser.'); });
  refresh();
}

async function main() {
  $('#pin-input').maxLength = PINNED_MAX;
  bindToken();
  $('#pin-input').addEventListener('input', preview);
  $('#pin-gif').addEventListener('change', () => setGif($('#pin-gif').value));
  $('#pin-gif').addEventListener('input', () => { gif = gifFromLink($('#pin-gif').value); preview(); });
  $('#pin-gif-file').addEventListener('change', () => uploadGif($('#pin-gif-file').files?.[0]));
  $('#pin-gif-clear').addEventListener('click', () => { setGif(''); note('GIF removed. Publish to update the site.'); });
  $('#pin-form').addEventListener('submit', (ev) => { ev.preventDefault(); publish(true); });
  $('#pin-hide').addEventListener('click', () => publish(false));
  try {
    current = await load();
  } catch (err) {
    note(String(err.message || err), 'is-bad');
  }
  $('#pin-input').value = current.text || '';
  gif = pinnedGif(current.gif) || '';
  $('#pin-gif').value = gif;
  showState();
  preview();
}

main();
