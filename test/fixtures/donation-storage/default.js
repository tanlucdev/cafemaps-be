const http = require('node:http');
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const path = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (path === '/__failure' && req.method === 'POST') {
    await pm.state.set('donation-storage:fail', body.toString() === 'true');
    return res.writeHead(204).end();
  }
  if (!path.startsWith('/storage/v1/object/')) return res.writeHead(404).end();
  if (req.method === 'POST') {
    if (await pm.state.get('donation-storage:fail')) return res.writeHead(503).end('Storage unavailable');
    await pm.state.set(`donation-storage:${path}`, body.toString('base64'));
    res.setHeader('Content-Type', 'application/json');
    return res.writeHead(200).end(JSON.stringify({ Key: path }));
  }
  if (req.method === 'GET') {
    const saved = await pm.state.get(`donation-storage:${path.replace('/object/public/', '/object/')}`);
    if (!saved) return res.writeHead(404).end();
    res.setHeader('Content-Type', 'image/webp');
    return res.writeHead(200).end(Buffer.from(saved, 'base64'));
  }
  if (req.method === 'DELETE') {
    await pm.state.set(`donation-storage:${path}`, null);
    return res.writeHead(200).end();
  }
  res.writeHead(405).end();
}).listen(process.env.PORT || 4500);
