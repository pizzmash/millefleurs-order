## 1. 仕様と実装

- [x] 1.1 提案・設計・差分仕様を作成し、表示順と対象範囲を記録する。
- [x] 1.2 ソート・常備材料の除外・説明削除を実装し差分を確認する。

## 2. 検証

- [x] 2.1 ビルド・既存テスト・OpenSpec strict検証・整形確認を実行する。

## 検証結果

- TypeScript / Viteビルド成功。
- 既存42テスト成功。
- OpenSpec strict検証21件成功。
- 変更TSXのPrettier確認とgit diff --check成功。
- ブラウザー表示確認は未実施。

## 3. PR CIの環境修正

- [x] 3.1 Playwright準備中のGoogle Chrome APTハッシュ不一致をログと再実行で確認する。
- [x] 3.2 CIで不要なGoogle Chrome APT配布元を無効にし、ハッシュ検証とブラウザーテストを維持する。
- [ ] 3.3 修正後のGitHub Actions成功を確認する。
