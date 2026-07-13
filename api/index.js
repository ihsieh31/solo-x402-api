const express = require('express');
const cors = require('cors');
const { createGatewayMiddleware } = require('@circle-fin/x402-batching/server');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ limit: '1mb' }));

const SELLER_ADDRESS = '0xffD98f88DC59eF83753E24D872705d677e4EE8c3';
const FACILITATOR_URL = 'https://gateway-api-testnet.circle.com';

const gateway = createGatewayMiddleware({
  sellerAddress: SELLER_ADDRESS,
  facilitatorUrl: FACILITATOR_URL,
  description: 'SOLO Autonomous Worker - Pay-per-call data processing API for AI agents. Pay in USDC via Circle Gateway.',
});

function getBodyText(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object') {
    return req.body.text || req.body.content || req.body.data || req.body.code || JSON.stringify(req.body);
  }
  return '';
}

app.post('/api/convert/csv-to-json', gateway.require('$0.002'), (req, res) => {
  const text = getBodyText(req);
  try {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return res.status(400).json({ error: 'CSV must have header + data rows' });
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const result = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
      result.push(row);
    }
    res.json({ success: true, data: result, count: result.length, fields: headers });
  } catch (err) {
    res.status(400).json({ error: 'CSV parse failed: ' + err.message });
  }
});

app.post('/api/convert/json-to-csv', gateway.require('$0.002'), (req, res) => {
  const text = getBodyText(req);
  try {
    let data = JSON.parse(text);
    if (!Array.isArray(data)) data = [data];
    if (data.length === 0) return res.status(400).json({ error: 'Empty data array' });
    const fields = [...new Set(data.flatMap(Object.keys))];
    const csvLines = [fields.join(',')];
    for (const row of data) {
      csvLines.push(fields.map(f => {
        const val = row[f];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(',') ? `"${str}"` : str;
      }).join(','));
    }
    res.json({ success: true, csv: csvLines.join('\n'), records: data.length, fields });
  } catch (err) {
    res.status(400).json({ error: 'Conversion failed: ' + err.message });
  }
});

app.post('/api/process/data-extract', gateway.require('$0.005'), (req, res) => {
  const text = getBodyText(req);
  const result = {
    emails: [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])],
    urls: [...new Set(text.match(/https?:\/\/[^\s<>"']+/g) || [])],
    wordCount: text.split(/\s+/).length,
    charCount: text.length,
    lines: text.split('\n').length,
  };
  res.json({ success: true, data: result });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', seller: SELLER_ADDRESS });
});

app.get('/api/.well-known/x402', (req, res) => {
  res.json({
    x402Version: 2,
    facilitator: FACILITATOR_URL,
    seller: SELLER_ADDRESS,
    description: 'SOLO Autonomous Worker API - Pay-per-call data and code processing for AI agents',
    endpoints: {
      '/api/convert/csv-to-json': { price: '$0.002', method: 'POST', description: 'Convert CSV text to JSON array' },
      '/api/convert/json-to-csv': { price: '$0.002', method: 'POST', description: 'Convert JSON array to CSV text' },
      '/api/process/data-extract': { price: '$0.005', method: 'POST', description: 'Extract emails URLs numbers from text' },
    },
  });
});

module.exports = app;
