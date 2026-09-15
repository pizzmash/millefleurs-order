export function loginErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'このドメインでのログインが許可されていません。Firebase Authenticationの承認済みドメインに、この画面のドメインを追加してください。';
    case 'auth/popup-blocked':
      return 'ログイン画面がブロックされました。ポップアップを許可するか、通常のブラウザーで開いて再試行してください。';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'ログイン画面が閉じられました。もう一度ログインしてください。';
    case 'auth/operation-not-allowed':
      return 'Googleログインが有効になっていません。Firebase Authenticationのログイン方法を確認してください。';
    case 'auth/network-request-failed':
      return 'ログイン先に接続できませんでした。通信環境を確認して再試行してください。';
    default:
      return `ログインできませんでした。もう一度お試しください。${typeof code === 'string' && /^auth\/[a-z-]+$/.test(code) ? `（${code}）` : ''}`;
  }
}
