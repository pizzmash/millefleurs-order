# Milleflewrs — Home Bar

家主がGoogleで登録し、自分の在庫から作れるカクテルを客人がQRで注文するWebアプリです。React + Vite / Cloudflare Pages + Workers + D1 / Firebase Authentication。R2は使用しません。

## 開発

Node.js 24.20.0で`npm ci`、`npm run cloud:setup:local`を実行し、Firebase設定後に`npm run dev`で起動します。画面はlocalhost:5173です。詳しい設定・デプロイ・移行・復旧は[公開運用手順](docs/DEPLOYMENT.md)を参照してください。

家主はGoogleログイン後、在庫を登録し、「お迎え」で受付を開始します。客人は招待QRからニックネームで参加します。バー名変更、受付停止、招待再発行も「お迎え」で行います。

## 検証

```sh
npm test
npm run build
npm run spec:validate
npm run format:check
```

[改修仕様](openspec/changes/web-service-migration/design.md)、[実装タスク](openspec/changes/web-service-migration/tasks.md)、[検証記録](VERIFICATION.md)を参照してください。本番リソース・Firebase設定・実機Googleログイン・クラウド配備は実環境での確認が必要です。

## データ

CSVはdata/rawでGit管理し、`npm run cloud:catalog`でversion付きD1投入SQLを生成します。画像は既存の外部URLを使用し、失敗時はアイコンを表示します。買い足し探索は家主ブラウザーのWeb Workerで実行します。

在庫は「ある／ない」、水・氷は常備品、同一kind_idは代用可能です。注文は「受付→提供完了」で、在庫減算や客人キャンセルは行いません。注文には受付時のレシピを保存します。

[旧LAN版の記録](docs/LEGACY-LAN.md)は移行元の調査用です。
