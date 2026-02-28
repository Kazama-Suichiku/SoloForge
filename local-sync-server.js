#!/usr/bin/env node
/**
 * SoloForge 本地同步服务器
 * 
 * 在 Mac 上运行，提供简单的数据同步服务
 * 使用方法：node local-sync-server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3002;
const DATA_DIR = path.join(os.homedir(), '.soloforge-sync');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const server = http.createServer((req, res) => {
  // CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  // 处理 OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathParts = url.pathname.split('/').filter(Boolean);

  // 健康检查
  if (url.pathname === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }

  // /sync/:userId
  if (pathParts[0] === 'sync' && pathParts[1]) {
    const userId = pathParts[1];
    const dataFile = path.join(DATA_DIR, `${userId}.json`);

    // GET - 获取数据
    if (req.method === 'GET') {
      try {
        if (fs.existsSync(dataFile)) {
          const data = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data }));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: null }));
        }
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }

    // POST - 保存数据
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
          console.log(`[${new Date().toISOString()}] 保存数据: ${userId}`);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, message: 'Data saved' }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: error.message }));
        }
      });
      return;
    }

    // DELETE - 删除数据
    if (req.method === 'DELETE') {
      try {
        if (fs.existsSync(dataFile)) {
          fs.unlinkSync(dataFile);
        }
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, message: 'Data deleted' }));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: error.message }));
      }
      return;
    }
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// 获取本机 IP
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('========================================');
  console.log('  SoloForge 本地同步服务器已启动');
  console.log('========================================');
  console.log('');
  console.log(`  本机访问: http://localhost:${PORT}`);
  console.log(`  局域网访问: http://${ip}:${PORT}`);
  console.log('');
  console.log('  在手机 App 中使用上述地址进行同步');
  console.log('  数据保存在: ' + DATA_DIR);
  console.log('');
  console.log('  按 Ctrl+C 停止服务器');
  console.log('========================================');
});
