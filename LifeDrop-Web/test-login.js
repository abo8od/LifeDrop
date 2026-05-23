const https = require('https');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = 'https://localhost:5001/api';

async function fetchApi(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (res.status === 204) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || `HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json.data !== undefined ? json.data : json;
}

async function run() {
  try {
    const lRes = await fetchApi('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@lifedrop.jo', password: 'Admin123!' })
    });
    const token = lRes.accessToken;
    console.log('Login success');
    
    // Check who this user is
    const user = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    console.log('User Role:', user['http://schemas.microsoft.com/ws/2008/06/identity/claims/role']);
  } catch (err) {
    console.error(err);
  }
}
run();
