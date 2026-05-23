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
  if (!res.ok) throw new Error(json.message + ' : ' + JSON.stringify(json.errors || json));
  return json.data !== undefined ? json.data : json;
}

async function run() {
  try {
    const jwt = require('jsonwebtoken');
    const secret = 'v9y$B&E)H@McQfTjWnZr4u7x!A%D*G-A';
    const adminToken = jwt.sign(
      {
        sub: '00000000-0000-0000-0000-000000000000',
        email: 'admin@lifedrop.jo',
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "SystemAdmin",
        jti: '00000000-0000-0000-0000-000000000001'
      },
      secret,
      { expiresIn: '1h', issuer: 'LifeDrop.Api', audience: 'LifeDrop.Client' }
    );
    
    // 2. Create hospital
    const hRes = await fetchApi('/hospitals', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ name: 'Test Hosp ' + Date.now(), address: 'Test Address', latitude: 31, longitude: 35 })
    });
    const hospitalId = hRes.hospitalId || hRes.id || hRes;
    console.log('Hospital ID:', hospitalId);

    // Create Hospital Admin
    const haEmail = `ha${Date.now()}@test.com`;
    await fetchApi('/hospitals/admin', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ hospitalId: hospitalId, firstName: 'A', lastName: 'A', email: haEmail, password: 'Password123!', phoneNumber: '1234567890' })
    });

    const haLogin = await fetchApi('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: haEmail, password: 'Password123!' })
    });
    const haToken = haLogin.accessToken;
    console.log('HA token ok');

    // Create Hospital Employee
    const empEmail = `emp${Date.now()}@test.com`;
    await fetchApi('/hospitals/employee', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${haToken}` },
      body: JSON.stringify({ hospitalId: hospitalId, firstName: 'E', lastName: 'E', email: empEmail, password: 'Password123!', phoneNumber: '1234567891', department: 'BB', position: 'Nurse' })
    });
    
    // Login as employee
    const empLogin = await fetchApi('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: empEmail, password: 'Password123!' })
    });
    const empToken = empLogin.accessToken;
    console.log('Emp token ok');

    // 3. Register donor
    const donorEmail = `donor${Date.now()}@test.com`;
    await fetchApi('/donors/register', {
      method: 'POST',
      body: JSON.stringify({ email: donorEmail, password: 'Password123!', confirmPassword: 'Password123!', firstName: 'D', lastName: 'D', dateOfBirth: '1990-01-01', bloodType: "O_Positive", phoneNumber: '+962790000000' })
    });
    
    const dVerify = await fetchApi('/donors/verify-registration', {
      method: 'POST',
      body: JSON.stringify({ email: donorEmail, code: '123456' })
    });
    const donorToken = dVerify.token || dVerify.accessToken;
    console.log('Donor token ok');



    // 4. Create request
    const reqRes = await fetchApi('/DonationRequests', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${empToken}` },
      body: JSON.stringify({ HospitalId: hospitalId, BloodType: 0, TargetQuota: 3, Urgency: 1, TargetDistrictIds: ['a8b4f1d9-3c72-4e6a-9f15-2b7c8d0e4a63'], ExpiryDate: new Date(Date.now() + 86400000).toISOString() })
    });
    const reqId = reqRes.requestId || reqRes;
    console.log('Request ID:', reqId);

    // 5. Donor accepts request
    const uuid = require('crypto').randomUUID();
    await fetchApi(`/DonationRequests/${reqId}/accept`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${donorToken}`, 'X-Idempotency-Key': uuid }
    });
    console.log('Accepted');

    // 6. Get request details
    const details = await fetchApi(`/DonationRequests/${reqId}`, {
      headers: { 'Authorization': `Bearer ${empToken}` }
    });

    console.log('--- Details JSON ---');
    console.log(JSON.stringify(details, null, 2));

  } catch (err) {
    console.error(err);
  }
}
run();
