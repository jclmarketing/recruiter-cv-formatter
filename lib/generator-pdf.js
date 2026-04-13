const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

function buildHtml(cvData, recruiter, logoPath, brandConfig) {
  const BRAND_COLOR = (brandConfig?.colours?.primary) || '#1B3A5C';
  const ACCENT_COLOR = (brandConfig?.colours?.secondary) || '#2E86AB';
  let logoSrc = '';
  if (logoPath && fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    const base64 = logoBuffer.toString('base64');
    const ext = path.extname(logoPath).slice(1) || 'png';
    logoSrc = `data:image/${ext};base64,${base64}`;
  }

  const logoOpacity = (brandConfig?.logoOpacity ?? 100) / 100;
  const logoSizePx = brandConfig?.logoSize || 150;
  const logoHtml = logoSrc
    ? `<img src="${logoSrc}" class="logo" style="width:${logoSizePx}px;opacity:${logoOpacity};" />`
    : `<div class="logo-text">LOGO</div>`;

  const headerHtml = `
    <div class="header">
      <div class="header-left">${logoHtml}</div>
      <div class="header-right">
        <div class="recruiter-name">${recruiter.name}</div>
        <div class="recruiter-detail">${recruiter.email}</div>
        <div class="recruiter-detail">${recruiter.phone}</div>
      </div>
    </div>
    <div class="header-line"></div>`;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let experienceHtml = '';
  if (cvData.experience && cvData.experience.length) {
    const entries = cvData.experience.map((exp) => `
      <div class="exp-entry">
        <div class="exp-header">
          <span class="exp-title">${esc(exp.title)}</span>
          <span class="exp-company">  |  ${esc(exp.company)}</span>
        </div>
        <div class="exp-dates">${esc(exp.dates || '')}</div>
        <ul class="bullets">${(exp.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      </div>`).join('');
    experienceHtml = `<div class="section"><div class="section-heading">PROFESSIONAL EXPERIENCE</div>${entries}</div>`;
  }

  let educationHtml = '';
  if (cvData.education && cvData.education.length) {
    const entries = cvData.education.map((edu) => `
      <div class="edu-entry">
        <span class="edu-qual">${esc(edu.qualification)}</span>
        <span class="edu-inst">  &mdash;  ${esc(edu.institution)}</span>
        ${edu.dates ? `<span class="edu-dates">  (${esc(edu.dates)})</span>` : ''}
      </div>`).join('');
    educationHtml = `<div class="section"><div class="section-heading">EDUCATION</div>${entries}</div>`;
  }

  let skillsHtml = '';
  if (cvData.skills && cvData.skills.length) {
    skillsHtml = `<div class="section"><div class="section-heading">KEY SKILLS</div>
      <div class="skills-list">${cvData.skills.map(esc).join('  |  ')}</div></div>`;
  }

  let certsHtml = '';
  if (cvData.certifications && cvData.certifications.length) {
    certsHtml = `<div class="section"><div class="section-heading">CERTIFICATIONS</div>
      <ul class="bullets">${cvData.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>`;
  }

  let additionalHtml = '';
  if (cvData.additionalInfo && cvData.additionalInfo.length) {
    additionalHtml = `<div class="section"><div class="section-heading">ADDITIONAL INFORMATION</div>
      <ul class="bullets">${cvData.additionalInfo.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
  }

  let summaryHtml = '';
  if (cvData.professionalSummary) {
    summaryHtml = `<div class="section"><div class="section-heading">PROFESSIONAL SUMMARY</div>
      <p class="summary-text">${esc(cvData.professionalSummary)}</p></div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 15mm 18mm 12mm 18mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 10pt; color: #333; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; }
  .logo { max-width: 250px; max-height: 250px; object-fit: contain; }
  .logo-text { font-size: 16pt; font-weight: bold; color: ${BRAND_COLOR}; }
  .header-right { text-align: right; }
  .recruiter-name { font-weight: bold; color: ${BRAND_COLOR}; font-size: 9pt; }
  .recruiter-detail { color: #555; font-size: 8pt; }
  .header-line { border-bottom: 2px solid ${ACCENT_COLOR}; margin-bottom: 10px; }
  .cover-page { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 70vh; text-align: center; }
  .cover-title { font-size: 22pt; font-weight: bold; color: ${BRAND_COLOR}; margin-bottom: 20px; letter-spacing: 2px; }
  .cover-divider { width: 200px; border-bottom: 2px solid ${ACCENT_COLOR}; margin: 15px auto; }
  .cover-field { font-size: 13pt; margin: 8px 0; }
  .cover-label { font-weight: bold; text-decoration: underline; color: ${BRAND_COLOR}; }
  .cover-value { font-weight: bold; text-decoration: underline; color: #333; }
  .page-break { page-break-before: always; }
  .section { margin-bottom: 12px; }
  .section-heading { font-size: 12pt; font-weight: bold; color: ${BRAND_COLOR}; border-bottom: 1px solid ${ACCENT_COLOR}; padding-bottom: 3px; margin-bottom: 6px; margin-top: 10px; }
  .summary-text { font-size: 10pt; color: #333; margin-bottom: 8px; }
  .exp-entry { margin-bottom: 10px; }
  .exp-title { font-weight: bold; color: ${BRAND_COLOR}; font-size: 11pt; }
  .exp-company { color: #555; font-size: 10pt; }
  .exp-dates { font-style: italic; color: #777; font-size: 9pt; margin-bottom: 3px; }
  .bullets { padding-left: 18px; margin: 3px 0; }
  .bullets li { font-size: 9.5pt; color: #333; margin-bottom: 2px; }
  .edu-entry { margin-bottom: 4px; }
  .edu-qual { font-weight: bold; color: ${BRAND_COLOR}; font-size: 10pt; }
  .edu-inst { color: #555; font-size: 10pt; }
  .edu-dates { font-style: italic; color: #777; font-size: 9pt; }
  .skills-list { font-size: 10pt; color: #333; line-height: 1.6; }
</style></head><body>

${headerHtml}
<div class="cover-page">
  <div class="cover-title">CANDIDATE PROFILE</div>
  <div class="cover-divider"></div>
  <div class="cover-field"><span class="cover-label">Candidate Name: </span><span class="cover-value">${esc(cvData.candidateName)}</span></div>
  <div class="cover-field"><span class="cover-label">Current Job Title: </span><span class="cover-value">${esc(cvData.currentJobTitle)}</span></div>
  <div class="cover-field"><span class="cover-label">Location: </span><span class="cover-value">${esc(cvData.location)}</span></div>
  <div class="cover-field"><span class="cover-label">Notice Period: </span><span class="cover-value">${esc(cvData.noticePeriod)}</span></div>
</div>

<div class="page-break"></div>
${headerHtml}
${summaryHtml}${experienceHtml}${educationHtml}${skillsHtml}${certsHtml}${additionalHtml}

</body></html>`;
}

async function generatePdf(cvData, recruiter, logoPath, outputPath, brandConfig) {
  const html = buildHtml(cvData, recruiter, logoPath, brandConfig);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '12mm', left: '18mm', right: '18mm' },
    });
  } finally {
    await browser.close();
  }

  return outputPath;
}

module.exports = { generatePdf };
