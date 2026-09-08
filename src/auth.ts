import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onIdTokenChanged,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const auth = Object.values(config).every(Boolean) ? getAuth(initializeApp(config)) : null;
export function useIdentity() {
  const [user, setUser] = useState<User | null>(auth?.currentUser || null);
  const [ready, setReady] = useState(!auth);
  useEffect(
    () =>
      auth
        ? onIdTokenChanged(auth, (u) => {
            setUser(u);
            setReady(true);
          })
        : undefined,
    [],
  );
  return { user, ready };
}
export async function login() {
  if (!auth) throw new Error('ログイン設定がまだ完了していません。');
  await signInWithPopup(auth, new GoogleAuthProvider());
}
export async function logout() {
  if (auth) await signOut(auth);
}
