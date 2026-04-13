const fs = require('fs');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

async function extractFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractFromPdf(buffer) {
  const parsed = await pdfParse(buffer);
  const textContent = parsed.text.trim();

  if (textContent.length < 100) {
    throw new Error(
      'This PDF appears to be image-based (scanned). Please convert it to a text-based PDF or DOCX first.'
    );
  }

  return textContent;
}

async function extract(filePath, originalName) {
  const buffer = fs.readFileSync(filePath);
  const lower = originalName.toLowerCase();

  if (lower.endsWith('.docx')) {
    return await extractFromDocx(buffer);
  }
  if (lower.endsWith('.pdf')) {
    return await extractFromPdf(buffer);
  }

  throw new Error('Unsupported file type. Please upload a PDF or DOCX file.');
}

module.exports = { extract };
