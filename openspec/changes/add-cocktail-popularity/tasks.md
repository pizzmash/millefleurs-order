## 実装
- [x] 1.1 提案・設計・差分仕様を作成してstrict検証する。
- [x] 1.2 既存集計移行・原子的加算・家主API・人気順を実装する。
- [x] 1.3 家主の注文数タブ・検索・リセット確認を実装する。
- [x] 1.4 分離・再送・移行・並行操作・ページ順・画面のテストを実施する。
- [x] 1.5 ビルド・書式・全テスト・runtime・OpenSpec strict検証を実施する。

## 検証結果
- origin/main（ddcaddb）をff-onlyでpullし、codex/cocktail-popularityで実装。
- npm test: 44件通過。実D1で既存履歴の集計、バー分離、再送・並行注文、リセット後の新規加算、失敗時の原子的ロールバック、カタログ削除・未注文・在庫なし、ページ送りを検証。
- メニューのページ分割前ソート、同数・同名の決定順、検索・種類・度数条件を検証。
- npm run build、npm run format:check、npm run test:runtime が通過。
- npm run spec:validate: strict 22件通過。既存changeのアーカイブに関するINFOは今回の変更と無関係。
- ブラウザーテスト通過。注文数タブの表示・検索・キャンセル・リセット失敗・成功・履歴保持を検証。320/390/768/1280pxの横はみ出しなし。320px画像を目視確認。
- ブラウザーは既存ChromiumをPLAYWRIGHT_CHROMIUM_EXECUTABLEで指定。初回は新機能に到達する前の既存Firebase合成ユーザー復元でタイムアウトしたが、再実行は全体通過。
- READMEに操作説明を追記。本番配備・実Google認証は未実施。配備時は既存deployスクリプトがWorker更新前に0002マイグレーションを適用する。
