#!/usr/bin/env node

// ViziQuer MCP Proxy — bridges stdio MCP clients to ViziQuer's HTTP JSON-RPC endpoint.
// Usage: VIZIQUER_API_KEY=vq_xxx node mcp-proxy.js [--url http://localhost:3000]

const readline = require('readline');
const VIZIQUER_URL = (process.argv.find(a => a.startsWith('--url=')) || '--url=http://localhost:3000').split('=')[1];
const API_KEY = process.env.VIZIQUER_API_KEY;

if (!API_KEY) {
  process.stderr.write('VIZIQUER_API_KEY environment variable is required\n');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);
    if (!msg.jsonrpc || !msg.method) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }) + '\n');
      return;
    }

    const response = await fetch(`${VIZIQUER_URL}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(msg),
    });
    const body = await response.json();
    process.stdout.write(JSON.stringify(body) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: err.message } }) + '\n');
  }
});
