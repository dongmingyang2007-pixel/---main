import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await context.newPage();
const origin = 'http://127.0.0.1:3200';
await context.addCookies([
  { name: 'auth_state', value: '1', url: origin, sameSite: 'Lax' },
  { name: 'access_token', value: 'playwright-access-token', url: origin, sameSite: 'Lax', httpOnly: true },
  { name: 'mingrun_workspace_id', value: 'ws-playwright', url: origin, sameSite: 'Lax' },
]);
await page.addInitScript(() => {
  window.__PLAYWRIGHT_FORCE_PROJECT_ID__ = 'proj-seed';
});
page.on('console', (msg) => console.log('console:', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('pageerror:', err.stack || err.message));
page.on('requestfailed', (req) => console.log('requestfailed:', req.url(), req.failure()?.errorText));
await page.route('**/api/v1/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const { pathname, searchParams } = url;
  const method = req.method().toUpperCase();
  const json = async (payload, status = 200) => route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });
  if (method === 'OPTIONS') return route.fulfill({ status: 204, body: '' });
  if (pathname === '/api/v1/auth/csrf') return json({ csrf_token: 'csrf-playwright-token' });
  if (pathname === '/api/v1/projects' && method === 'GET') return json({ items: [{ id: 'proj-seed', name: 'Seed Console Project' }] });
  if (pathname === '/api/v1/projects/proj-seed' && method === 'GET') {
    return json({ id: 'proj-seed', name: 'Seed Console Project', description: '', default_chat_mode: 'standard', assistant_root_memory_id: 'memory-root', created_at: '2026-03-18T08:00:00.000Z' });
  }
  if (pathname === '/api/v1/pipeline' && method === 'GET') return json({ items: [] });
  if (pathname === '/api/v1/chat/conversations' && method === 'GET') return json([]);
  if (pathname === '/api/v1/memory' && method === 'GET' && searchParams.get('project_id') === 'proj-seed') {
    return json({
      nodes: [
        { id: 'memory-root', workspace_id: 'ws-playwright', project_id: 'proj-seed', content: '学习助手', category: 'assistant', type: 'permanent', source_conversation_id: null, parent_memory_id: null, position_x: 0, position_y: 0, metadata_json: { node_kind: 'assistant-root', assistant_name: '学习助手' }, created_at: '2026-03-18T08:00:00.000Z', updated_at: '2026-03-18T08:00:00.000Z' },
        { id: 'memory-interest', workspace_id: 'ws-playwright', project_id: 'proj-seed', content: '学习兴趣', category: '学习.兴趣', type: 'permanent', source_conversation_id: null, parent_memory_id: 'memory-root', position_x: 180, position_y: 0, metadata_json: {}, created_at: '2026-03-18T08:10:00.000Z', updated_at: '2026-03-18T08:10:00.000Z' },
        { id: 'memory-math', workspace_id: 'ws-playwright', project_id: 'proj-seed', content: '数学', category: '数学家', type: 'permanent', source_conversation_id: null, parent_memory_id: 'memory-interest', position_x: 300, position_y: 36, metadata_json: {}, created_at: '2026-03-18T08:20:00.000Z', updated_at: '2026-03-18T08:20:00.000Z' },
        { id: 'file:memory-math-principles', workspace_id: 'ws-playwright', project_id: 'proj-seed', content: '数学物理原理：理论、方法及其统一', category: 'file', type: 'permanent', source_conversation_id: null, parent_memory_id: 'memory-interest', position_x: null, position_y: null, metadata_json: { node_kind: 'file', filename: '数学物理原理：理论、方法及其统一' }, created_at: '2026-03-18T08:30:00.000Z', updated_at: '2026-03-18T08:30:00.000Z' },
      ],
      edges: [
        { id: 'edge-interest-math', source_memory_id: 'memory-interest', target_memory_id: 'memory-math', edge_type: 'manual', strength: 0.8, created_at: '2026-03-18T08:20:00.000Z' },
        { id: 'file-edge:memory-math-principles', source_memory_id: 'memory-interest', target_memory_id: 'file:memory-math-principles', edge_type: 'file', strength: 0.2, created_at: '2026-03-18T08:30:00.000Z' },
      ],
    });
  }
  if (/\/api\/v1\/memory\/[^/]+\/stream$/.test(pathname) || /\/api\/v1\/chat\/conversations\/[^/]+\/memory-stream$/.test(pathname)) {
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
  }
  console.log('unhandled', method, pathname, url.search);
  return json({ error: { message: `Unhandled ${method} ${pathname}` } }, 501);
});

try {
  const response = await page.goto('http://127.0.0.1:3200/app/memory?project_id=proj-seed', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  console.log('goto', response?.status(), page.url());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '.tmp/check-memory-graph.png', fullPage: true });
  const debug = await page.evaluate(() => window.__QIHANG_MEMORY_GRAPH_DEBUG__ || null);
  console.log('debug', JSON.stringify(debug, null, 2));
  console.log('stats', await page.locator('.graph-controls-stats').innerText());
} catch (error) {
  console.log('script failed', error);
}
await browser.close();
