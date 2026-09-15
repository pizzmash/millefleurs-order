## 実装
- [x] 1.1 現行UIを検討し、提案・設計・差分仕様を作成する。
- [x] 1.2 共通ダイアログと管理操作領域を実装し、補足を移動する。
- [x] 1.3 ブラウザーで中止・フォーカス・通信中・失敗・成功とレスポンシブ表示を検証する。
- [x] 1.4 書式・ビルド・テスト・OpenSpec strict検証を実施する。
- [x] 1.5 差分をレビューして変更内容と検証結果を記録する。

## 検証結果
- origin/main（94ebcae）をpullし、codex/refine-host-confirmationsで実装。最終fetch時も同じmainを確認。
- npm run format:check、npm run build、npm test（44件）が通過。
- npm run spec:validate: strict 23件通過。既存changeのアーカイブに関するINFOは今回の変更と無関係。
- npm run test:runtime: Pages → Service binding → Worker → D1の結合検証が通過。
- npm run test:browser: 両操作のキャンセル・Escape・フォーカス循環と復帰、実行中の中止防止・単一リクエスト、失敗時の表示、成功時の反映を確認。
- 320/390/768/1280px幅と390×320pxでレイアウト・ボタン寸法・スクロール到達を確認。招待確認390px、リセット確認320/390pxを目視確認。390pxの実行ラベルの折り返しを修正後、ビルド・ブラウザー検証を再実行して通過。
- リセット補足の配置、失敗・中止時の集計／招待URL保持、成功時の0杯／新URL、履歴保持も確認。
- PLAYWRIGHT_CHROMIUM_EXECUTABLEでローカルChromiumを指定。本番配備は行っていない。
