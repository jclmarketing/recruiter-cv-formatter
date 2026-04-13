module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }

  let domain;
  try {
    const parsed = new URL(url.startsWith('http') ? url : 'https://' + url);
    domain = parsed.hostname.replace(/^www\./, '');
  } catch {
    domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }

  // Return logo URLs for client-side fetching and processing
  res.json({
    domain,
    logoUrl: `https://logo.clearbit.com/${domain}`,
    logoUrlHD: `https://logo.clearbit.com/${domain}?size=400`,
    faviconUrl: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
  });
};
