import app from './app';
import type { Bindings } from './types';
export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, env: Bindings) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM guest_sessions WHERE expires_at<?').bind(Date.now()),
      env.DB.prepare('DELETE FROM rate_limits WHERE window<?').bind(
        Math.floor(Date.now() / 60000) - 2,
      ),
    ]);
  },
};
