const PDFDocument = require('pdfkit');

function hexToRGB(hex) {
  hex = (hex || '#333333').replace('#', '');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}

function esc(s) {
  return String(s || '');
}

async function generatePdf(cvData, recruiter, logoBuffer, brandConfig) {
  const primary = brandConfig?.colours?.primary || '#1B3A5C';
  const secondary = brandConfig?.colours?.secondary || '#2E86AB';
  const logoSizePx = brandConfig?.logoSize || 150;
  const logoOpacity = (brandConfig?.logoOpacity ?? 100) / 100;

  const primaryRGB = hexToRGB(primary);
  const secondaryRGB = hexToRGB(secondary);
  const darkGrey = [51, 51, 51];
  const midGrey = [85, 85, 85];
  const lightGrey = [119, 119, 119];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 42, bottom: 34, left: 51, right: 51 },
      bufferPages: true,
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const marginLeft = doc.page.margins.left;
    const marginRight = doc.page.margins.right;
    const contentWidth = pageWidth - marginLeft - marginRight;

    function drawHeader() {
      const startY = doc.page.margins.top;

      // Logo (left side)
      if (logoBuffer && logoBuffer.length > 100) {
        try {
          doc.save();
          doc.opacity(logoOpacity);
          doc.image(logoBuffer, marginLeft, startY, { width: Math.min(logoSizePx, contentWidth * 0.45) });
          doc.opacity(1);
          doc.restore();
        } catch (e) {
          // Skip logo if it can't be rendered
        }
      }

      // Recruiter info (right side)
      const rightX = pageWidth - marginRight;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(primaryRGB)
        .text(esc(recruiter.name), marginLeft, startY, { width: contentWidth, align: 'right' });
      doc.font('Helvetica').fontSize(8).fillColor(midGrey)
        .text(esc(recruiter.email), marginLeft, doc.y, { width: contentWidth, align: 'right' })
        .text(esc(recruiter.phone), marginLeft, doc.y, { width: contentWidth, align: 'right' });

      // Accent line
      const lineY = Math.max(doc.y + 6, startY + 50);
      doc.strokeColor(secondaryRGB).lineWidth(2)
        .moveTo(marginLeft, lineY)
        .lineTo(rightX, lineY)
        .stroke();

      doc.y = lineY + 10;
    }

    function sectionHeading(text) {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(primaryRGB)
        .text(text.toUpperCase());
      const lineY = doc.y + 2;
      doc.strokeColor(secondaryRGB).lineWidth(1)
        .moveTo(marginLeft, lineY)
        .lineTo(pageWidth - marginRight, lineY)
        .stroke();
      doc.y = lineY + 6;
    }

    function bulletPoint(text) {
      const bulletX = marginLeft + 6;
      const textX = marginLeft + 14;
      const y = doc.y;

      // Check if we need a new page
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage();
        drawHeader();
      }

      doc.font('Helvetica').fontSize(9.5).fillColor(darkGrey);
      doc.text('•', marginLeft, doc.y, { continued: false, width: 12 });
      // Move back up to same line for the text
      doc.y = doc.y - doc.currentLineHeight();
      doc.text(esc(text), textX, doc.y, { width: contentWidth - 14 });
      doc.y += 2;
    }

    // ─── COVER PAGE ───
    drawHeader();

    // Center the cover content vertically
    doc.y = doc.page.height * 0.3;
    doc.font('Helvetica-Bold').fontSize(22).fillColor(primaryRGB)
      .text('CANDIDATE PROFILE', marginLeft, doc.y, { width: contentWidth, align: 'center' });

    doc.moveDown(0.8);
    const dividerY = doc.y;
    const dividerWidth = 200;
    const dividerX = marginLeft + (contentWidth - dividerWidth) / 2;
    doc.strokeColor(secondaryRGB).lineWidth(2)
      .moveTo(dividerX, dividerY)
      .lineTo(dividerX + dividerWidth, dividerY)
      .stroke();
    doc.y = dividerY + 20;

    // Cover fields
    const fields = [
      ['Candidate Name', cvData.candidateName],
      ['Current Job Title', cvData.currentJobTitle],
      ['Location', cvData.location],
      ['Notice Period', cvData.noticePeriod],
    ];
    for (const [label, value] of fields) {
      doc.font('Helvetica-Bold').fontSize(13).fillColor(primaryRGB)
        .text(`${label}: `, marginLeft, doc.y, { width: contentWidth, align: 'center', continued: true })
        .fillColor(darkGrey)
        .text(esc(value), { underline: true });
      doc.moveDown(0.3);
    }

    // ─── CONTENT PAGES ───
    doc.addPage();
    drawHeader();

    // Professional Summary
    if (cvData.professionalSummary) {
      sectionHeading('Professional Summary');
      doc.font('Helvetica').fontSize(10).fillColor(darkGrey)
        .text(esc(cvData.professionalSummary), marginLeft, doc.y, { width: contentWidth });
      doc.moveDown(0.5);
    }

    // Experience
    if (cvData.experience && cvData.experience.length) {
      sectionHeading('Professional Experience');
      for (const exp of cvData.experience) {
        // Check space for at least the header
        if (doc.y > doc.page.height - doc.page.margins.bottom - 60) {
          doc.addPage();
          drawHeader();
        }

        doc.font('Helvetica-Bold').fontSize(11).fillColor(primaryRGB)
          .text(esc(exp.title), marginLeft, doc.y, { continued: true })
          .font('Helvetica').fontSize(10).fillColor(midGrey)
          .text(`  |  ${esc(exp.company)}`);

        if (exp.dates) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor(lightGrey)
            .text(esc(exp.dates));
        }
        doc.moveDown(0.2);

        for (const b of exp.bullets || []) {
          bulletPoint(b);
        }
        doc.moveDown(0.4);
      }
    }

    // Education
    if (cvData.education && cvData.education.length) {
      sectionHeading('Education');
      for (const edu of cvData.education) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) {
          doc.addPage();
          drawHeader();
        }
        doc.font('Helvetica-Bold').fontSize(10).fillColor(primaryRGB)
          .text(esc(edu.qualification), marginLeft, doc.y, { continued: true })
          .font('Helvetica').fontSize(10).fillColor(midGrey)
          .text(`  —  ${esc(edu.institution)}`, { continued: !!edu.dates });
        if (edu.dates) {
          doc.font('Helvetica-Oblique').fontSize(9).fillColor(lightGrey)
            .text(`  (${esc(edu.dates)})`);
        }
      }
      doc.moveDown(0.5);
    }

    // Skills
    if (cvData.skills && cvData.skills.length) {
      sectionHeading('Key Skills');
      doc.font('Helvetica').fontSize(10).fillColor(darkGrey)
        .text(cvData.skills.join('  |  '), marginLeft, doc.y, { width: contentWidth });
      doc.moveDown(0.5);
    }

    // Certifications
    if (cvData.certifications && cvData.certifications.length) {
      sectionHeading('Certifications');
      for (const c of cvData.certifications) bulletPoint(c);
      doc.moveDown(0.3);
    }

    // Additional Info
    if (cvData.additionalInfo && cvData.additionalInfo.length) {
      sectionHeading('Additional Information');
      for (const info of cvData.additionalInfo) bulletPoint(info);
    }

    doc.end();
  });
}

module.exports = { generatePdf };
