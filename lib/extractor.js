const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const Tesseract = require('tesseract.js');

const MIN_CHARS_PER_PAGE = 80;

async function extractFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function extractFromPdf(buffer) {
  const parsed = await pdfParse(buffer);
  const textContent = parsed.text.trim();
  const pageCount = parsed.numpages || 1;
  const avgCharsPerPage = textContent.length / pageCount;

  if (avgCharsPerPage >= MIN_CHARS_PER_PAGE && textContent.length > 100) {
    return textContent;
  }

  // Image-based PDF — use OCR via tesseract.js on the raw PDF
  console.log('Low text content detected, attempting OCR...');
  try {
    const worker = await Tesseract.createWorker('eng');
    // tesseract.js can handle PDF buffers directly
    const { data: { text } } = await worker.recognize(buffer);
    await worker.terminate();
    if (text && text.trim().length > textContent.length) {
      return text.trim();
    }
  } catch (err) {
    console.warn('OCR failed:', err.message);
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
