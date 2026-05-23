const jwt = require('jsonwebtoken');

const secret = 'v9y$B&E)H@McQfTjWnZr4u7x!A%D*G-A';
const donorToken = jwt.sign(
  {
    sub: '019deeb8-dc90-7b24-bbe3-b641bf13b92e', // Just a random GUID
    email: 'donor@lifedrop.jo',
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "Donor",
    jti: '00000000-0000-0000-0000-000000000002'
  },
  secret,
  { expiresIn: '1h', issuer: 'LifeDrop.Api', audience: 'LifeDrop.Client' }
);
console.log(donorToken);
