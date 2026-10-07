// modify fetch wrapper to include auth token
export async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('qb_token');
  const headers = opts.headers ?? {};
  headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { window.location.href = '/static/login.html'; throw new Error('unauthorized'); }
  return res.json().catch(()=>null);
}
