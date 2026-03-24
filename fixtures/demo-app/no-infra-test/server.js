const http = require('http');
const server = http.createServer((req, res) => { res.end('Demo App - Powered by Node.js'); });
server.listen(3000);
