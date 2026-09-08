import type { D1Database } from '@cloudflare/workers-types';
export type Bindings = {
  DB: D1Database;
  APP_ENV: 'local' | 'staging' | 'production';
  PUBLIC_APP_URL: string;
  FIREBASE_PROJECT_ID: string;
};
export type Bar = {
  id: string;
  owner_uid: string;
  name: string;
  accepting_orders: number;
  inventory_version: number;
  invite_version: number;
  invite_token: string;
};
export type Session = {
  guest_id: string;
  nickname: string;
  bar_id: string;
  token_hash: string;
  invite_version: number;
  expires_at: number;
};
export type Identity = { uid: string; name: string };
export type Env = {
  Bindings: Bindings;
  Variables: { identity: Identity; bar: Bar; guest: Session; requestId: string };
};
