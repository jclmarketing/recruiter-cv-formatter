require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

const { extract } = require('./lib/extractor');
const { parseCV } = require('./lib/parser');
const { generateDocx } = require('./lib/generator-docx');
const { generatePdf } = require('./lib/generator-pdf');
const { scrapeBrand } = require('./lib/scraper');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ASSETS_DIR = path.join(__dirname, 'assets');
const CONFIG_DIR = path.join(__dirname, 'config');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Multer config
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.pdf') || name.endsWith('.docx')) cb(null, true);
    else cb(new Error('Only PDF and DOCX files are accepted'));
  },
});

// Static files
app.use(express.static(path.join(__dirname, 'static')));
app.use(express.json());

// API: recruiters
app.get('/api/recruiters', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'recruiters.json'), 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load recruiters' });
  }
});

// API: company
app.get('/api/company', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'company.json'), 'utf8'));
    res.json(data);
  } catch (err) {
    res.json({ name: 'Recruitment Firm', tagline: '' });
  }
});

// API: save company settings
app.post('/api/company', (req, res) => {
  try {
    const current = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'company.json'), 'utf8'));
    const updated = { ...current, ...req.body, setupComplete: true };
    fs.writeFileSync(path.join(CONFIG_DIR, 'company.json'), JSON.stringify(updated, null, 2));
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save company settings' });
  }
});

// API: scrape brand from website
app.post('/api/scrape-brand', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'No URL provided' });
  try {
    const result = await scrapeBrand(url, ASSETS_DIR);
    res.json(result);
  } catch (err) {
    console.error('Scrape error:', err);
    res.status(500).json({ error: `Failed to scrape: ${err.message}` });
  }
});

// API: upload logo manually
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: ASSETS_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `logo${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
});
app.post('/api/upload-logo', logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const logoFullPath = path.join(ASSETS_DIR, req.file.filename);
  let brandColours = [];

  try {
    const logoBase64 = fs.readFileSync(logoFullPath).toString('base64');
    const mimeType = req.file.mimetype || 'image/png';
    const dataUri = `data:${mimeType};base64,${logoBase64}`;

    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // Step 1: Remove white background and extract brand colours
    const result = await page.evaluate(async (src) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          // ── REMOVE WHITE/NEAR-WHITE BACKGROUND ──
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2];
            const brightness = (r + g + b) / 3;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const saturation = max - min;
            // If very bright and low saturation → it's background
            if (brightness > 230 && saturation < 30) {
              data[i+3] = 0; // make transparent
            }
          }
          ctx.putImageData(imageData, 0, 0);
          const cleanedDataUrl = canvas.toDataURL('image/png');

          // ── EXTRACT BRAND COLOURS ──
          // Count colours, filtering out:
          // - Transparent pixels (background removed)
          // - Greys/dark greys (text colours like #555, #666, #333)
          // - Black and near-black
          // - White and near-white
          const counts = {};
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
            if (a < 128) continue;

            const brightness = (r + g + b) / 3;
            if (brightness > 220) continue; // too light
            if (brightness < 20) continue;  // too dark

            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const saturation = max - min;

            // SKIP GREYS — this is the key filter for text colours
            // Greys have very low saturation (R≈G≈B)
            // Text in logos is typically grey (#555, #666, #4a4a4a etc)
            if (saturation < 35) continue;

            // Quantize to group similar shades (round to nearest 16)
            const qr = Math.round(r / 16) * 16;
            const qg = Math.round(g / 16) * 16;
            const qb = Math.round(b / 16) * 16;
            const key = qr + ',' + qg + ',' + qb;
            counts[key] = (counts[key] || 0) + 1;
          }

          // Sort by frequency
          const sorted = Object.entries(counts)
            .sort((a, b) => b[1] - a[1]);

          // Get distinct colours — ensure they're visually different from each other
          const distinct = [];
          for (const [key, count] of sorted) {
            if (distinct.length >= 6) break;
            const [r, g, b] = key.split(',').map(Number);

            // Check this colour is visually distinct from already-picked ones
            let tooSimilar = false;
            for (const existing of distinct) {
              const dr = Math.abs(r - existing.r);
              const dg = Math.abs(g - existing.g);
              const db = Math.abs(b - existing.b);
              if (dr + dg + db < 80) { tooSimilar = true; break; }
            }
            if (tooSimilar) continue;

            const hex = '#' + [r, g, b].map(c =>
              Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0')
            ).join('').toUpperCase();
            distinct.push({ r, g, b, hex, count });
          }

          resolve({
            colours: distinct.map(d => d.hex),
            cleanedDataUrl,
          });
        };
        img.onerror = () => resolve({ colours: [], cleanedDataUrl: null });
        img.src = src;
      });
    }, dataUri);

    // Save the cleaned (background-removed) logo
    if (result.cleanedDataUrl) {
      const base64Data = result.cleanedDataUrl.replace(/^data:image\/png;base64,/, '');
      const cleanedPath = logoFullPath.replace(/\.[^.]+$/, '.png');
      fs.writeFileSync(cleanedPath, Buffer.from(base64Data, 'base64'));
      // Remove original if it was a different format
      if (cleanedPath !== logoFullPath) {
        try { fs.unlinkSync(logoFullPath); } catch (e) {}
      }
      console.log('Logo saved with background removed');
    }

    brandColours = result.colours || [];
    console.log('Brand colours extracted:', brandColours);

    await browser.close();
  } catch (err) {
    console.warn('Logo processing failed:', err.message);
  }

  // Auto-update company config with first extracted colour
  if (brandColours.length > 0) {
    try {
      const configPath = path.join(CONFIG_DIR, 'company.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.colours = { primary: brandColours[0], secondary: '#000000' };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) {}
  }

  res.json({
    success: true,
    path: req.file.filename,
    brandColours,
    colours: brandColours.length > 0
      ? { primary: brandColours[0], secondary: '#000000' }
      : null,
  });
});

// API: save recruiters
app.post('/api/recruiters', (req, res) => {
  try {
    const recruiters = req.body;
    if (!Array.isArray(recruiters)) return res.status(400).json({ error: 'Expected array of recruiters' });
    fs.writeFileSync(path.join(CONFIG_DIR, 'recruiters.json'), JSON.stringify(recruiters, null, 2));
    res.json(recruiters);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save recruiters' });
  }
});

// API: serve current logo
app.get('/api/logo', (req, res) => {
  const exts = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
  for (const ext of exts) {
    const p = path.join(ASSETS_DIR, `logo${ext}`);
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).json({ error: 'No logo found' });
});

// API: generate branded CV
app.post('/api/generate', upload.single('cv'), async (req, res) => {
  const jobId = uuidv4();
  const start = Date.now();
  let docxPath, pdfPath, zipPath;

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { recruiterId, customFilename } = req.body;
  if (!recruiterId) return res.status(400).json({ error: 'No recruiter selected' });

  // Load recruiter
  let recruiter;
  try {
    const recruiters = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'recruiters.json'), 'utf8'));
    recruiter = recruiters.find((r) => r.id === recruiterId);
    if (!recruiter) return res.status(400).json({ error: 'Recruiter not found' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load recruiters' });
  }

  // Find logo (any extension, prefer raster for DOCX compatibility)
  let logoPath = null;
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.svg']) {
    const p = path.join(ASSETS_DIR, `logo${ext}`);
    if (fs.existsSync(p)) { logoPath = p; break; }
  }

  // If logo is SVG, convert to PNG for DOCX compatibility
  if (logoPath && logoPath.endsWith('.svg')) {
    const pngPath = path.join(ASSETS_DIR, 'logo_converted.png');
    if (!fs.existsSync(pngPath)) {
      try {
        console.log(`[${jobId}] Converting SVG logo to PNG...`);
        const puppeteer = require('puppeteer');
        const svgContent = fs.readFileSync(logoPath, 'utf8');
        const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(`<html><body style="margin:0;background:transparent;">${svgContent}</body></html>`);
        const svgEl = await page.$('svg');
        if (svgEl) {
          await svgEl.screenshot({ path: pngPath, omitBackground: true });
        }
        await browser.close();
      } catch (err) {
        console.warn('SVG to PNG conversion failed:', err.message);
      }
    }
    if (fs.existsSync(pngPath)) logoPath = pngPath;
  }
  if (!logoPath) logoPath = path.join(ASSETS_DIR, 'logo.png');

  // Load brand config
  let brandConfig;
  try {
    brandConfig = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'company.json'), 'utf8'));
  } catch (e) {
    brandConfig = { colours: { primary: '#1B3A5C', secondary: '#2E86AB' }, fonts: ['Calibri'] };
  }
  console.log(`[${jobId}] Brand colours: primary=${brandConfig.colours?.primary}, secondary=${brandConfig.colours?.secondary}`);
  console.log(`[${jobId}] Logo path: ${logoPath} (exists: ${fs.existsSync(logoPath)})`);

  try {
    // Extract text
    console.log(`[${jobId}] Extracting text from ${req.file.originalname}...`);
    const rawText = await extract(req.file.path, req.file.originalname);
    if (!rawText || rawText.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract meaningful text from the CV.' });
    }

    // Parse with AI
    console.log(`[${jobId}] Parsing CV with AI...`);
    const cvData = await parseCV(rawText);

    // Filenames
    const baseName = customFilename && customFilename.trim()
      ? customFilename.trim()
      : `${cvData.candidateName.replace(/[^a-zA-Z0-9\s\-]/g, '').trim()}_CV_Branded`;

    docxPath = path.join(OUTPUT_DIR, `${jobId}.docx`);
    pdfPath = path.join(OUTPUT_DIR, `${jobId}.pdf`);
    zipPath = path.join(OUTPUT_DIR, `${jobId}.zip`);

    // Generate DOCX
    console.log(`[${jobId}] Generating DOCX...`);
    await generateDocx(cvData, recruiter, logoPath, docxPath, brandConfig);

    // Generate PDF
    console.log(`[${jobId}] Generating PDF...`);
    await generatePdf(cvData, recruiter, logoPath, pdfPath, brandConfig);

    // Zip both
    console.log(`[${jobId}] Creating zip...`);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.file(docxPath, { name: `${baseName}.docx` });
      archive.file(pdfPath, { name: `${baseName}.pdf` });
      archive.finalize();
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${jobId}] Done in ${elapsed}s`);

    res.download(zipPath, `${baseName}.zip`, () => {
      // Cleanup
      for (const f of [req.file.path, docxPath, pdfPath, zipPath]) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
      }
    });
  } catch (err) {
    console.error(`[${jobId}] Error:`, err);
    for (const f of [req.file?.path, docxPath, pdfPath, zipPath]) {
      try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (e) {}
    }
    res.status(500).json({ error: err.message || 'Failed to generate CV' });
  }
});

app.listen(PORT, () => {
  console.log(`\nCV Rebrander running at http://localhost:${PORT}`);
  console.log(`OpenAI API Key: ${process.env.OPENAI_API_KEY ? 'Configured' : 'NOT SET — export OPENAI_API_KEY'}\n`);
});
