## 1. 構成の整理

- [x] 1.1 既存README・実装・運用資料・CIを確認し、design.mdの項目表に必要な内容と掲載理由を整理する。
- [x] 1.2 proposalとdesignを作成し、動作変更がないことを確認してskip_specsを設定する。

## 2. READMEの再作成

- [x] 2.1 初見向けのREADMEを書き、機能・設定名・コマンドを実装と照合する。
- [x] 2.2 目次と内部リンクの解決、ライセンス状態と現行／旧版の区別を確認する。

## 3. 検証と提出

- [x] 3.1 ローカルDB初期化・API起動と自動検証を実行し、結果と未実施範囲を記録する。
- [ ] 3.2 差分を確認してコミット・pushし、main向けPRのURLを確認する。

## 検証結果

- Node.js 24.20.0で`npm ci`成功。
- `npm run cloud:setup:local`成功。材料209件・カクテル955件のSQL生成、D1投入と有効化を確認。
- `npm run dev`でViteとWranglerを起動し、画面とVite経由の`/api/health`がHTTP 200、health本文が`{"ok":true}`であることを確認。
- `npm test`: 36件成功。
- `npm run build`: 型検査・Viteビルド成功。
- `npm run spec:validate`: 20件成功、失敗0。既存changeのarchiveに関するINFOは今回の変更対象外。
- `npm run format:check`とREADME・change文書のPrettierチェック成功。
- READMEの27リンクを抽出し、相対パスと目次・見出しアンカーの存在を検証。外部URLの到達性は検証対象外。
- `git diff --check`成功。READMEの機能、環境変数、コマンド、CI説明を実ファイルと照合。
- 文書のみの変更のため、ブラウザーE2E・ランタイム統合テストはローカルでは再実行しない。PRのCIは両方を実行する。
- Firebase実ログイン、実機スマートフォン、クラウド配備は未実施。
