// Supabase REST API helper for t_cv_formatter schema
const SUPABASE_URL = 'https://srv1581646.hstgr.cloud';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc2MDEyMjUzLCJleHAiOjIwOTEzNzIyNTN9.g1QzpSerMck6NmuKEKxoa_IE9ePcS-kmWCIgSerHyZc';
const SCHEMA = 't_cv_formatter';

async function getSetting(key) {
  const url = `${SUPABASE_URL}/rest/v1/settings?key=eq.${encodeURIComponent(key)}&select=value`;
  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Accept-Profile': SCHEMA,
    },
  });
  if (!resp.ok) throw new Error(`Supabase error: ${resp.status}`);
  const rows = await resp.json();
  return rows[0]?.value || null;
}

async function upsertSetting(key, value, label) {
  const url = `${SUPABASE_URL}/rest/v1/settings`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Content-Profile': SCHEMA,
      'Accept-Profile': SCHEMA,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({ key, value, label, updated_at: new Date().toISOString() }),
  });
  if (!resp.ok) throw new Error(`Supabase error: ${resp.status}`);
  return await resp.json();
}

async function getAllSettings() {
  const url = `${SUPABASE_URL}/rest/v1/settings?select=key,value,label,updated_at`;
  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Accept-Profile': SCHEMA,
    },
  });
  if (!resp.ok) throw new Error(`Supabase error: ${resp.status}`);
  return await resp.json();
}

module.exports = { getSetting, upsertSetting, getAllSettings, SUPABASE_URL, SUPABASE_ANON_KEY, SCHEMA };
