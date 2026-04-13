const {
  Document, Packer, Paragraph, TextRun, ImageRun, Header,
  Table, TableRow, TableCell, WidthType, AlignmentType,
  BorderStyle, PageBreak, convertInchesToTwip,
} = require('docx');

let BRAND_COLOR = '1B3A5C';
let ACCENT_COLOR = '2E86AB';

function applyBrand(brandConfig) {
  if (brandConfig && brandConfig.colours) {
    BRAND_COLOR = (brandConfig.colours.primary || '#1B3A5C').replace('#', '');
    ACCENT_COLOR = (brandConfig.colours.secondary || '#2E86AB').replace('#', '');
  }
}

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
}

function getImageDimensions(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(18);
    return { width, height };
  }
  let i = 2;
  while (i < buffer.length - 8) {
    if (buffer[i] === 0xFF) {
      const marker = buffer[i + 1];
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8) {
        const height = buffer.readUInt16BE(i + 5);
        const width = buffer.readUInt16BE(i + 7);
        return { width, height };
      }
      const len = buffer.readUInt16BE(i + 2);
      i += 2 + len;
    } else {
      i++;
    }
  }
  return { width: 300, height: 90 };
}

function createBrandedHeader(recruiter, logoBuffer, logoSizePx) {
  const logoCellChildren = [];
  if (logoBuffer && logoBuffer.length > 0) {
    const dims = getImageDimensions(logoBuffer);
    const w = logoSizePx || 150;
    const h = Math.round(dims.height * (w / dims.width));

    logoCellChildren.push(
      new Paragraph({
        children: [
          new ImageRun({ data: logoBuffer, transformation: { width: w, height: h }, type: 'png' }),
        ],
      })
    );
  } else {
    logoCellChildren.push(new Paragraph({ children: [] }));
  }

  const borders = {
    top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(),
  };

  const headerTable = new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: logoCellChildren,
            borders,
            width: { size: 50, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 0 },
                children: [
                  new TextRun({ text: recruiter.name, bold: true, size: 18, color: BRAND_COLOR, font: 'Calibri' }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 0 },
                children: [
                  new TextRun({ text: recruiter.email, size: 16, color: '555555', font: 'Calibri' }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { after: 0 },
                children: [
                  new TextRun({ text: recruiter.phone, size: 16, color: '555555', font: 'Calibri' }),
                ],
              }),
            ],
            borders,
            width: { size: 50, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(),
      insideHorizontal: noBorder(), insideVertical: noBorder(),
    },
  });

  return new Header({
    children: [
      headerTable,
      new Paragraph({
        border: { bottom: { color: ACCENT_COLOR, space: 1, style: BorderStyle.SINGLE, size: 6 } },
        spacing: { after: 100 },
        children: [],
      }),
    ],
  });
}

function coverField(label, value) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 250 },
    children: [
      new TextRun({ text: `${label}: `, bold: true, underline: {}, size: 26, color: BRAND_COLOR, font: 'Calibri' }),
      new TextRun({ text: value, bold: true, underline: {}, size: 26, color: '333333', font: 'Calibri' }),
    ],
  });
}

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    border: { bottom: { color: ACCENT_COLOR, space: 2, style: BorderStyle.SINGLE, size: 2 } },
    children: [
      new TextRun({ text: text.toUpperCase(), bold: true, size: 24, color: BRAND_COLOR, font: 'Calibri' }),
    ],
  });
}

function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 40 },
    children: [new TextRun({ text, size: 19, color: '333333', font: 'Calibri' })],
  });
}

function spacer(count = 1) {
  return Array.from({ length: count }, () => new Paragraph({ spacing: { after: 200 }, children: [] }));
}

async function generateDocx(cvData, recruiter, logoBuffer, brandConfig) {
  applyBrand(brandConfig);

  const logoSizePx = brandConfig?.logoSize || 150;
  const header = createBrandedHeader(recruiter, logoBuffer, logoSizePx);

  const coverContent = [
    ...spacer(6),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [new TextRun({ text: 'CANDIDATE PROFILE', bold: true, size: 36, color: BRAND_COLOR, font: 'Calibri' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { color: ACCENT_COLOR, space: 4, style: BorderStyle.SINGLE, size: 4 } },
      spacing: { after: 400 },
      children: [],
    }),
    ...spacer(1),
    coverField('Candidate Name', cvData.candidateName),
    coverField('Current Job Title', cvData.currentJobTitle),
    coverField('Location', cvData.location),
    coverField('Notice Period', cvData.noticePeriod),
  ];

  const content = [];

  if (cvData.professionalSummary) {
    content.push(sectionHeading('Professional Summary'));
    content.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: cvData.professionalSummary, size: 20, color: '333333', font: 'Calibri' })],
    }));
  }

  if (cvData.experience && cvData.experience.length) {
    content.push(sectionHeading('Professional Experience'));
    for (const exp of cvData.experience) {
      content.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: exp.title, bold: true, size: 22, color: BRAND_COLOR, font: 'Calibri' }),
          new TextRun({ text: `  |  ${exp.company}`, size: 20, color: '555555', font: 'Calibri' }),
        ],
      }));
      if (exp.dates) {
        content.push(new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: exp.dates, italics: true, size: 18, color: '777777', font: 'Calibri' })],
        }));
      }
      for (const b of exp.bullets || []) content.push(bullet(b));
      content.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
  }

  if (cvData.education && cvData.education.length) {
    content.push(sectionHeading('Education'));
    for (const edu of cvData.education) {
      content.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: edu.qualification, bold: true, size: 20, color: BRAND_COLOR, font: 'Calibri' }),
          new TextRun({ text: `  —  ${edu.institution}`, size: 20, color: '555555', font: 'Calibri' }),
          ...(edu.dates ? [new TextRun({ text: `  (${edu.dates})`, italics: true, size: 18, color: '777777' })] : []),
        ],
      }));
    }
    content.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }

  if (cvData.skills && cvData.skills.length) {
    content.push(sectionHeading('Key Skills'));
    content.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: cvData.skills.join('  |  '), size: 20, color: '333333', font: 'Calibri' })],
    }));
  }

  if (cvData.certifications && cvData.certifications.length) {
    content.push(sectionHeading('Certifications'));
    for (const c of cvData.certifications) content.push(bullet(c));
    content.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }

  if (cvData.additionalInfo && cvData.additionalInfo.length) {
    content.push(sectionHeading('Additional Information'));
    for (const info of cvData.additionalInfo) content.push(bullet(info));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 20 } } } },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(0.8),
            bottom: convertInchesToTwip(0.6),
            left: convertInchesToTwip(0.7),
            right: convertInchesToTwip(0.7),
          },
        },
      },
      headers: { default: header },
      children: [
        ...coverContent,
        new Paragraph({ children: [new PageBreak()] }),
        ...content,
      ],
    }],
  });

  return await Packer.toBuffer(doc);
}

module.exports = { generateDocx };
