/**
 * SoloForge Cloud Sync - Cloudflare Worker
 * 
 * 简单的数据同步服务，使用 Cloudflare KV 存储
 * 
 * 部署方法：
 * 1. 注册 Cloudflare 账号
 * 2. 创建 Worker
 * 3. 创建 KV namespace: SOLOFORGE_DATA
 * 4. 绑定 KV 到 Worker
 * 5. 部署此代码
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
  async fetch(request, env) {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // GET /sync/:userId - 获取用户数据
      if (request.method === 'GET' && path.startsWith('/sync/')) {
        const userId = path.split('/')[2];
        if (!userId) {
          return jsonResponse({ error: 'Missing userId' }, 400);
        }

        const data = await env.SOLOFORGE_DATA.get(userId, 'json');
        return jsonResponse({ success: true, data: data || null });
      }

      // POST /sync/:userId - 上传用户数据
      if (request.method === 'POST' && path.startsWith('/sync/')) {
        const userId = path.split('/')[2];
        if (!userId) {
          return jsonResponse({ error: 'Missing userId' }, 400);
        }

        const body = await request.json();
        
        // 保存数据到 KV，设置 30 天过期
        await env.SOLOFORGE_DATA.put(userId, JSON.stringify(body), {
          expirationTtl: 30 * 24 * 60 * 60,
        });

        return jsonResponse({ success: true, message: 'Data saved' });
      }

      // DELETE /sync/:userId - 删除用户数据
      if (request.method === 'DELETE' && path.startsWith('/sync/')) {
        const userId = path.split('/')[2];
        if (!userId) {
          return jsonResponse({ error: 'Missing userId' }, 400);
        }

        await env.SOLOFORGE_DATA.delete(userId);
        return jsonResponse({ success: true, message: 'Data deleted' });
      }

      // 健康检查
      if (path === '/health') {
        return jsonResponse({ status: 'ok', timestamp: Date.now() });
      }

      return jsonResponse({ error: 'Not found' }, 404);

    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}
