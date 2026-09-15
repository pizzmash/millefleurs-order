import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './cloud-fixture';

test('embedded local requests require an explicit matching custom header; deployed and foreign origins stay rejected', async () => {
  const s = await setup();
  try {
    const origin = 'http://localhost:5173';
    s.env.APP_ENV = 'local';
    s.env.PUBLIC_APP_URL = origin;
    const send = (headers: Record<string, string>) =>
      s.app.request(
        origin + '/api/host/bootstrap',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer alice',
            ...headers,
          },
          body: '{}',
        },
        s.env,
      );
    assert.equal((await send({})).status, 403);
    assert.equal((await send({ 'X-Millefleurs-Origin': 'https://evil.example' })).status, 403);
    assert.equal((await send({ 'X-Millefleurs-Origin': origin })).status, 200);
    assert.equal(
      (await send({ Origin: 'https://evil.example', 'X-Millefleurs-Origin': origin })).status,
      403,
    );
    assert.equal((await send({ Origin: 'null', 'X-Millefleurs-Origin': origin })).status, 403);
    assert.equal((await send({ Origin: origin })).status, 200);
    const preflight = await s.app.request(
      origin + '/api/host/bootstrap',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'x-millefleurs-origin,content-type',
        },
      },
      s.env,
    );
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), null);
    for (const env of ['staging', 'production'] as const) {
      s.env.APP_ENV = env;
      s.env.PUBLIC_APP_URL = 'https://bar.example.com';
      assert.equal((await send({ 'X-Millefleurs-Origin': 'https://bar.example.com' })).status, 403);
    }
  } finally {
    await s.mf.dispose();
  }
});
