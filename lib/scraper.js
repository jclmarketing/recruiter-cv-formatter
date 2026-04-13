const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * Download a binary file from a URL and return the buffer.
 */
function downloadImage(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        return downloadImage(next, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/**
 * Get the domain from a URL (e.g. "https://www.deel.com/foo" → "deel.com")
 */
function getDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    // Strip "www."
    return hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * LOGO: Use Clearbit Logo API — the most reliable way to get a company's logo.
 * Falls back to Google's high-res favicon service.
 */
async function fetchLogo(websiteUrl, assetsDir) {
  const domain = getDomain(websiteUrl);

  // Clear ALL old logos
  for (const ext of ['png', 'jpg', 'jpeg', 'svg', 'webp']) {
    const old = path.join(assetsDir, `logo.${ext}`);
    try { if (fs.existsSync(old)) fs.unlinkSync(old); } catch (e) {}
  }
  try { fs.unlinkSync(path.join(assetsDir, 'logo_converted.png')); } catch (e) {}

  // Try Clearbit Logo API first (returns the actual company logo as PNG)
  const sources = [
    { url: `https://logo.clearbit.com/${domain}`, name: 'Clearbit' },
    { url: `https://logo.clearbit.com/${domain}?size=400`, name: 'Clearbit HD' },
    { url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`, name: 'Google Favicon' },
  ];

  for (const source of sources) {
    try {
      console.log(`Trying logo from ${source.name}: ${source.url}`);
      const buffer = await downloadImage(source.url);
      if (buffer.length > 500) {
        const logoPath = path.join(assetsDir, 'logo.png');
        fs.writeFileSync(logoPath, buffer);
        console.log(`Logo saved from ${source.name} (${buffer.length} bytes)`);
        return { saved: true, source: source.name };
      }
    } catch (err) {
      console.warn(`${source.name} failed:`, err.message);
    }
  }

  return { saved: false, source: null };
}

/**
 * COLOURS & FONTS: Use Puppeteer to render the page and extract real computed styles.
 * This catches CSS variables, external stylesheets, JS-injected styles — everything.
 */
async function extractBrandFromRenderedPage(websiteUrl) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(websiteUrl, { waitUntil: 'networkidle2', timeout: 20000 });

    // Extract colours and fonts from the actual rendered page
    const brandData = await page.evaluate(() => {
      const colours = {};
      const fonts = new Set();

      // ── COLOURS ──

      // 1. Get colours from CSS custom properties on :root / html / body
      const root = document.documentElement;
      const rootStyles = getComputedStyle(root);
      const bodyStyles = getComputedStyle(document.body);

      // Check common CSS variable names for brand colours
      const varNames = [
        '--primary', '--primary-color', '--brand-color', '--brand-primary',
        '--color-primary', '--theme-primary', '--main-color', '--accent',
        '--accent-color', '--secondary', '--secondary-color', '--brand-secondary',
        '--color-accent', '--highlight', '--link-color',
      ];
      const cssVarColours = [];
      for (const name of varNames) {
        const val = rootStyles.getPropertyValue(name).trim();
        if (val && val !== '') cssVarColours.push(val);
      }

      // 2. Get colours from key page elements (header, nav, buttons, links)
      const colourSamples = [];

      // Header/nav background
      const header = document.querySelector('header') || document.querySelector('nav');
      if (header) {
        const hs = getComputedStyle(header);
        colourSamples.push({ colour: hs.backgroundColor, source: 'header-bg', weight: 3 });
        colourSamples.push({ colour: hs.color, source: 'header-text', weight: 2 });
      }

      // Primary buttons
      const buttons = document.querySelectorAll('a[class*="btn"], button[class*="btn"], a[class*="cta"], button[class*="cta"], .btn-primary, .button-primary');
      buttons.forEach((btn, i) => {
        if (i > 2) return; // only first 3
        const bs = getComputedStyle(btn);
        colourSamples.push({ colour: bs.backgroundColor, source: 'button-bg', weight: 4 });
        colourSamples.push({ colour: bs.color, source: 'button-text', weight: 1 });
      });

      // Links
      const links = document.querySelectorAll('a');
      const linkColours = new Map();
      links.forEach((a, i) => {
        if (i > 20) return;
        const colour = getComputedStyle(a).color;
        linkColours.set(colour, (linkColours.get(colour) || 0) + 1);
      });
      // Most common link colour
      let topLinkColour = null, topLinkCount = 0;
      linkColours.forEach((count, colour) => {
        if (count > topLinkCount) { topLinkColour = colour; topLinkCount = count; }
      });
      if (topLinkColour) colourSamples.push({ colour: topLinkColour, source: 'link', weight: 3 });

      // Headings
      const h1 = document.querySelector('h1');
      if (h1) colourSamples.push({ colour: getComputedStyle(h1).color, source: 'h1', weight: 2 });

      // Body
      colourSamples.push({ colour: bodyStyles.backgroundColor, source: 'body-bg', weight: 1 });
      colourSamples.push({ colour: bodyStyles.color, source: 'body-text', weight: 2 });

      // Convert all to hex and filter
      function rgbToHex(rgb) {
        if (!rgb) return null;
        if (rgb.startsWith('#')) return rgb.toUpperCase();
        const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (!match) return null;
        const [, r, g, b] = match.map(Number);
        return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
      }

      function isUseful(hex) {
        if (!hex) return false;
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const brightness = (r + g + b) / 3;
        if (brightness > 245 || brightness < 10) return false; // too white or too black
        // Allow near-black brand colours (like #1B1B1B) but filter pure greys
        const maxDiff = Math.max(r, g, b) - Math.min(r, g, b);
        if (maxDiff < 5 && brightness > 30 && brightness < 225) return false;
        return true;
      }

      // Process CSS variable colours first (highest confidence)
      const brandColours = [];
      cssVarColours.forEach(c => {
        const hex = rgbToHex(c);
        if (hex && isUseful(hex)) brandColours.push({ hex, weight: 5 });
      });

      // Then sampled colours
      colourSamples.forEach(({ colour, weight }) => {
        const hex = rgbToHex(colour);
        if (hex && isUseful(hex)) brandColours.push({ hex, weight });
      });

      // Deduplicate and sort by weight
      const colourMap = new Map();
      brandColours.forEach(({ hex, weight }) => {
        colourMap.set(hex, (colourMap.get(hex) || 0) + weight);
      });
      const sorted = [...colourMap.entries()].sort((a, b) => b[1] - a[1]);

      colours.primary = sorted[0]?.[0] || '#1B3A5C';
      colours.secondary = sorted[1]?.[0] || '#2E86AB';
      colours.accent = sorted[2]?.[0] || '#333333';
      colours.allFound = sorted.map(([hex]) => hex);

      // ── FONTS ──
      // Get font from body, headings, and nav
      [document.body, document.querySelector('h1'), document.querySelector('h2'),
       document.querySelector('header'), document.querySelector('nav')]
        .filter(Boolean)
        .forEach(el => {
          const family = getComputedStyle(el).fontFamily;
          family.split(',').forEach(f => {
            f = f.trim().replace(/["']/g, '');
            const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
              'system-ui', '-apple-system', 'BlinkMacSystemFont', 'ui-sans-serif', 'ui-serif'];
            if (f && !generics.includes(f.toLowerCase())) fonts.add(f);
          });
        });

      return {
        colours,
        fonts: [...fonts].slice(0, 5),
      };
    });

    return brandData;
  } finally {
    await browser.close();
  }
}

/**
 * Main: scrape a website and return brand config.
 */
async function scrapeBrand(websiteUrl, assetsDir) {
  if (!websiteUrl.startsWith('http')) websiteUrl = 'https://' + websiteUrl;

  // Strip tracking parameters — just use the base domain
  try {
    const parsed = new URL(websiteUrl);
    websiteUrl = `${parsed.protocol}//${parsed.hostname}`;
  } catch {}

  console.log(`\nScraping brand from ${websiteUrl}...`);

  // 1. Fetch logo via Clearbit (most reliable)
  console.log('Fetching logo...');
  const logoResult = await fetchLogo(websiteUrl, assetsDir);

  // 2. Extract colours and fonts by rendering the page
  console.log('Rendering page for colours and fonts...');
  let brandData;
  try {
    brandData = await extractBrandFromRenderedPage(websiteUrl);
  } catch (err) {
    console.warn('Puppeteer extraction failed:', err.message);
    brandData = {
      colours: { primary: '#1B3A5C', secondary: '#2E86AB', accent: '#333333', allFound: [] },
      fonts: ['Calibri'],
    };
  }

  console.log('Colours found:', brandData.colours.primary, brandData.colours.secondary, brandData.colours.accent);
  console.log('Fonts found:', brandData.fonts);
  console.log('Logo:', logoResult.saved ? `Saved from ${logoResult.source}` : 'Not found');

  return {
    colours: brandData.colours,
    fonts: brandData.fonts.length > 0 ? brandData.fonts : ['Calibri'],
    logoSaved: logoResult.saved,
    logoSource: logoResult.source,
  };
}

module.exports = { scrapeBrand };
