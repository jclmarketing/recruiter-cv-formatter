const formidable = require('formidable');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const { PassThrough } = require('stream');

const { extract } = require('../lib/extractor');
const { parseCV } = require('../lib/parser');
const { generateDocx } = require('../lib/generator-docx');
const { generatePdf } = require('../lib/generator-pdf');
const { getSetting } = require('../lib/supabase');

// Disable Vercel's built-in body parser for multipart
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const jobId = uuidv4().slice(0, 8);
  const start = Date.now();

  try {
    // Parse multipart form data
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 20 * 1024 * 1024,
    });

    const [fields, files] = await form.parse(req);

    const cvFile = files.cv?.[0];
    if (!cvFile) {
      return res.status(400).json({ error: 'No CV file uploaded' });
    }

    // Parse config from form field
    let config;
    try {
      config = JSON.parse(fields.config?.[0] || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid config JSON' });
    }

    const recruiter = config.recruiter;
    if (!recruiter || !recruiter.name) {
      return res.status(400).json({ error: 'No recruiter selected' });
    }

    const brandConfig = {
      colours: config.company?.colours || { primary: '#1B3A5C', secondary: '#2E86AB' },
      logoSize: config.company?.logoSize || 150,
      logoOpacity: config.company?.logoOpacity ?? 100,
    };

    // Decode logo from base64
    let logoBuffer = null;
    if (config.logoBase64) {
      const base64Data = config.logoBase64.replace(/^data:image\/\w+;base64,/, '');
      logoBuffer = Buffer.from(base64Data, 'base64');
    }

    // Step 1: Extract text
    console.log(`[${jobId}] Extracting text from ${cvFile.originalFilename}...`);
    const rawText = await extract(cvFile.filepath, cvFile.originalFilename || 'file.pdf');
    if (!rawText || rawText.trim().length < 20) {
      return res.status(400).json({ error: 'Could not extract meaningful text from the CV.' });
    }

    // Step 2: Fetch OpenAI key from Supabase and parse with AI
    console.log(`[${jobId}] Fetching OpenAI key...`);
    const openaiKey = await getSetting('openai_api_key');
    if (!openaiKey) {
      return res.status(400).json({ error: 'OpenAI API key not configured. Go to Settings to add it.' });
    }
    process.env.OPENAI_API_KEY = openaiKey;

    console.log(`[${jobId}] Parsing CV with AI...`);
    const cvData = await parseCV(rawText);

    // Step 3: Generate DOCX
    console.log(`[${jobId}] Generating DOCX...`);
    const docxBuffer = await generateDocx(cvData, recruiter, logoBuffer, brandConfig);

    // Step 4: Generate PDF
    console.log(`[${jobId}] Generating PDF...`);
    const pdfBuffer = await generatePdf(cvData, recruiter, logoBuffer, brandConfig);

    // Step 5: ZIP both files
    const baseName = config.customFilename?.trim()
      || `${cvData.candidateName.replace(/[^a-zA-Z0-9\s\-]/g, '').trim()}_CV_Branded`;

    console.log(`[${jobId}] Creating ZIP...`);
    const zipBuffer = await new Promise((resolve, reject) => {
      const chunks = [];
      const passthrough = new PassThrough();
      passthrough.on('data', (chunk) => chunks.push(chunk));
      passthrough.on('end', () => resolve(Buffer.concat(chunks)));
      passthrough.on('error', reject);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', reject);
      archive.pipe(passthrough);
      archive.append(docxBuffer, { name: `${baseName}.docx` });
      archive.append(pdfBuffer, { name: `${baseName}.pdf` });
      archive.finalize();
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${jobId}] Done in ${elapsed}s`);

    // Return ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.zip"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.status(200).send(zipBuffer);

  } catch (err) {
    console.error(`[${jobId}] Error:`, err);
    res.status(500).json({ error: err.message || 'Failed to generate CV' });
  }
};
