import { readFileSync } from 'node:fs';

/**
 * A replaced app icon never reached anyone who had already installed the app.
 *
 * An installed PWA keeps showing the icon it was installed with. The icons
 * were referenced by fixed names, so swapping the file changed nothing a phone
 * could notice: the URL was identical and the manifest byte-for-byte the same,
 * so the home-screen shortcut kept the old picture until the app was deleted
 * and installed again. The service worker made it worse — images are cached
 * CacheFirst for a week, so even the in-page icon lagged behind.
 *
 * Hashing the icon files into their own URLs makes a new icon a new URL, which
 * makes the manifest different, which is what Chrome's periodic update check
 * looks for before it will rebuild an installed app's icon. Nothing has to be
 * bumped by hand: replace an icon and the version follows.
 */

function fail(message) {
  throw new Error(message);
}

function expectContains(text, needle, label) {
  if (!text.includes(needle)) fail(`${label}: missing ${needle}`);
}

const config = readFileSync('vite.config.ts', 'utf8');

// ── The version comes from the files, not from someone remembering ──────────
expectContains(config, 'const iconVersion', 'the icon version is declared');
expectContains(config, 'createHash', 'the version is a hash of the icon bytes');
if (/iconVersion\s*=\s*['"`]/.test(config)) {
  fail('the icon version is hardcoded — it would have to be bumped by hand and would be forgotten');
}

// ── Every icon feeds it ─────────────────────────────────────────────────────
// Hashing only one file meant replacing any of the others left the version
// unchanged and those icons stayed stale.
for (const file of ['logo-192.png', 'logo-512.jpg', 'favicon-32.png', 'apple-touch-icon.png']) {
  expectContains(config, file, `${file} feeds the icon version`);
}

// ── Every icon URL carries it ───────────────────────────────────────────────
const iconsBlock = config.slice(config.indexOf('icons: ['), config.indexOf('shortcuts:'));
const srcs = iconsBlock.match(/src: [`'][^`']+[`']/g) || [];
if (srcs.length < 3) fail(`expected at least 3 manifest icons, found ${srcs.length}`);
for (const src of srcs) {
  if (!src.includes('?v=${iconVersion}')) fail(`manifest icon is not versioned: ${src}`);
}

// The shortcut icon is a separate list and was easy to miss.
const shortcutBlock = config.slice(config.indexOf('shortcuts:'), config.indexOf('workbox:'));
for (const src of shortcutBlock.match(/src: [`'][^`']+[`']/g) || []) {
  if (!src.includes('?v=${iconVersion}')) fail(`shortcut icon is not versioned: ${src}`);
}

// ── The tab and Apple home-screen icons in the HTML too ─────────────────────
expectContains(config, 'transformIndexHtml', 'the HTML icon links are rewritten at build time');
expectContains(config, 'favicon-32\\.png|apple-touch-icon\\.png', 'both HTML icons are rewritten');

// ── The install is not mistaken for a different app ─────────────────────────
// Without an explicit id Chrome derives one from start_url, which carries a
// utm parameter here and would take the install with it if that ever changed.
if (!/id: '\/'/.test(config)) fail('the manifest does not pin an app id');

console.log('App icon update regressions passed.');
