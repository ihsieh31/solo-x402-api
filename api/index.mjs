import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import { createServer } from 'http';
import { parse } from 'url';

const SELLER_ADDRESS = '0xffD98f88DC59eF83753E24D872705d677e4EE8c3';
const FACILITATOR_URL = 'https://gateway-api-testnet.circle.com';

const gateway = createGatewayMiddleware({
  sellerAddress: SELLER_ADDRESS,
  facilitatorUrl: FACILITATOR_URL,
  description: 'SOLO Autonomous Worker API',
});

function getBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve(body); }
    });
  });
}

async function handler(req, res) {
  const url = parse(req.url, true);
  const path = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Payment-Required, Payload, Accepts');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health
  if (path === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '1.0.0', seller: SELLER_ADDRESS }));
    return;
  }

  // x402 discovery
  if (path === '/api/.well-known/x402' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      x402Version: 2,
      facilitator: FACILITATOR_URL,
      seller: SELLER_ADDRESS,
      description: 'SOLO Autonomous Worker API',
      endpoints: {
        '/api/convert/csv-to-json': { price: '$0.002', method: 'POST', description: 'Convert CSV to JSON' },
        '/api/convert/json-to-csv': { price: '$0.002', method: 'POST', description: 'Convert JSON to CSV' },
        '/api/process/data-extract': { price: '$0.005', method: 'POST', description: 'Extract emails/URLs from text' },
        '/api/process/web-research': { price: '$0.010', method: 'POST', description: 'Fetch and extract web content' },
      },
    }));
    return;
  }

  // Paid endpoints
  if ((path === '/api/convert/csv-to-json' || path === '/api/convert/json-to-csv' || path === '/api/process/data-extract' || path === '/api/process/web-research') && req.method === 'POST') {
    const prices = { '/api/convert/csv-to-json': '$0.002', '/api/convert/json-to-csv': '$0.002', '/api/process/data-extract': '$0.005', '/api/process/web-research': '$0.010' };
    
    // Check payment via gateway
    const paymentResult = await new Promise(resolve => {
      const fakeReq = { headers: req.headers, method: 'POST', url: path };
      const fakeRes = { 
        statusCode: 0, headers: {}, body: '',
        writeHead(s, h) { this.statusCode = s; this.headers = h || {}; return this; },
        end(b) { this.body = b; resolve(this); }
      };
      // Simple: just check if payment header exists
      if (req.headers['payment-required'] || req.headers['PAYMENT-REQUIRED']) {
        // Payment provided - verify
        resolve({ statusCode: 200, headers: {}, body: '' });
      } else {
        // Payment required
        const paymentReq = {
          x402Version: 2,
          resource: { url: path, description: 'API Service', mimeType: 'application/json' },
          accepts: [{ scheme: 'exact', network: 'eip155:11155111', asset: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', amount: '2000', payTo: SELLER_ADDRESS, maxTimeoutSeconds: 604900 }]
        };
        resolve({ statusCode: 402, headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(paymentReq)).toString('base64') }, body: JSON.stringify({ error: 'Payment required' }) });
      }
    });

    if (paymentResult.statusCode === 402) {
      res.writeHead(402, { 'Content-Type': 'application/json', 'PAYMENT-REQUIRED': paymentResult.headers['PAYMENT-REQUIRED'] });
      res.end(paymentResult.body);
      return;
    }

    // Process request
    const body = await getBody(req);
    const text = typeof body === 'string' ? body : (body?.text || body?.content || body?.data || JSON.stringify(body));

    if (path === '/api/convert/csv-to-json') {
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const result = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const row = {};
        headers.forEach((h, idx) => row[h] = vals[idx] || '');
        result.push(row);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: result, count: result.length }));
    }
    else if (path === '/api/convert/json-to-csv') {
      let data = JSON.parse(text);
      if (!Array.isArray(data)) data = [data];
      const fields = [...new Set(data.flatMap(Object.keys))];
      const csv = [fields.join(',')];
      for (const row of data) {
        csv.push(fields.map(f => { const v = row[f]; return v?.toString().includes(',') ? '"' + v + '"' : (v?.toString() || ''); }).join(','));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, csv: csv.join('\n'), records: data.length }));
    }
    else if (path === '/api/process/data-extract') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        data: {
          emails: [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])],
          urls: [...new Set(text.match(/https?:\/\/[^\s<>"']+/g) || [])],
          wordCount: text.split(/\s+/).length,
          charCount: text.length,
        }
      }));
    }
    else if (path === '/api/process/web-research') {
      const url = body?.url || text;
      try {
        const resp = await fetch(url, { headers: { 'User-Agent': 'SOLO/1.0' }, signal: AbortSignal.timeout(10000) });
        const html = await resp.text();
        const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
        const clean = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 5000);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: { url, title, textContent: clean, wordCount: clean.split(/\s+/).length } }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Fetch failed: ' + e.message }));
      }
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path }));
}

export default handler;
