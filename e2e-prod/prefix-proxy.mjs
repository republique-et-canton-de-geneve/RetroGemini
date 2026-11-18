import http from 'node:http';
import net from 'node:net';

const prefix = '/retrogemini';
const pathAtBackend = (url) => {
  const path = url.split('?')[0];
  return path === prefix || path.startsWith(prefix + '/')
    ? (url.slice(prefix.length) || '/').replace(/^\?/, '/?')
    : null;
};

const server = http.createServer((req, res) => {
  const path = pathAtBackend(req.url);
  if (path === null) {
    res.writeHead(404).end();
    return;
  }
  const upstream = http.request({ host: '127.0.0.1', port: 34100, path, method: req.method, headers: req.headers }, (reply) => {
    res.writeHead(reply.statusCode, reply.headers);
    reply.pipe(res);
  });
  upstream.on('error', () => res.writeHead(502).end());
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  const path = pathAtBackend(req.url);
  if (path === null) return socket.destroy();
  const upstream = net.connect(34100, '127.0.0.1', () => {
    const headers = req.rawHeaders.reduce((lines, value, i, all) => i % 2 ? lines : lines + `${value}: ${all[i + 1]}\r\n`, '');
    upstream.write(`${req.method} ${path} HTTP/1.1\r\n${headers}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});

server.listen(34101, '127.0.0.1');
