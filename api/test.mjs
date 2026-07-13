export default async function handler(req, res) {
  return new Promise((resolve) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', node: process.version, env: process.env.NODE_ENV }));
    resolve();
  });
}
