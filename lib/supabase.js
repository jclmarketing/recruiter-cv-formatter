// Supabase REST API helper for t_cv_formatter schema
// Server-side uses service_role key to bypass RLS (settings table requires auth)
const SUPABASE_URL = 'https://srv1581646.hstgr.cloud';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NzYwMTIyNTMsImV4cCI6MjA5MTM3MjI1M30.QslE-g6-tvDmqLYfgvybjB073k8slUyOPkDmYTDm62o';
const SCHEMA = 't_cv_formatter';

async function getSetting(key) {
  const url = `${SUPABASE_URL}/rest/v1/settings?key=eq.${encodeURIComponent(key)}&select=value`;
  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Accept-Profile': SCHEMA,
    },
  });
  if (!resp.ok) throw new Error(`Supabase error: ${resp.status}`);
  const rows = await resp.json();
  return rows[0]?.value || null;
}

module.exports = { getSetting, SUPABASE_URL, SCHEMA };
