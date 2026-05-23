const jwt = require('jsonwebtoken');

const token = jwt.sign(
  {
    sub: '00000000-0000-0000-0000-000000000000',
    email: 'admin@lifedrop.jo',
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role": "SystemAdmin",
    jti: '00000000-0000-0000-0000-000000000001'
  },
  'v9y$B&E)H@McQfTjWnZr4u7x!A%D*G-A',
  {
    expiresIn: '1h',
    issuer: 'LifeDrop.Api',
    audience: 'LifeDrop.Client'
  }
);

console.log(token);
