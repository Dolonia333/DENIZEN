// Compatibility launcher: keep `node server.js` working from the repo root.
console.log('[root-server] delegating to apps/office/server.js');
require('./apps/office/server.js');
