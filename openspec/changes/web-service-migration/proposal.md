## Why

現在の単一家庭・自宅LAN向けアプリを、複数の家主が登録して利用できるWebサービスに移行する。在庫・招待・客人・注文を家主に紐づけ、PCを起動し続けなくても利用できるようにする。

本changeはクラウド版を実装しローカルで検証済み。クラウドリソース作成・実アカウント認証・本番デプロイは環境設定待ち。ユーザー指定と設計提案を区別し、未確定事項はdiscussion.mdに記載する。

## What Changes

### ユーザー指定

- 家主がユーザー登録し、在庫などのデータを自身のアカウントに紐づける。
- インターネット上にデプロイしてWebサービスとして提供する。
- Cloudflare Pages + Workersを利用する。R2はユーザーの指示により初回構成から除外。
- Firebase AuthenticationのGoogleサインインを利用する想定。
- デプロイ先に応じたQRコードのURL設定を整理する。

### 推奨する初回リリース仕様

- 家主はGoogleで登録・ログイン。初回ログインで自分のバーを1つ作成する。
- カタログは全家主で共有し、在庫・注文・招待・客人参加情報はバー単位で分離する。
- 客人は引き続き登録不要。バーごとの招待QRからニックネームで参加する。
- 招待リンクの再発行と注文受付の停止・再開を追加する。
- Pagesで画面を配信し、Pages Functionsの中継からService bindingでAPI Workerを呼ぶ。同一オリジンの`/api/*`を使う。
- 在庫・注文などの構造化データ用にCloudflare D1を追加する。画像は既存の外部URLとPagesの静的ファイルを使用する。
- 公開環境では`PUBLIC_APP_URL`を必須にし、家主ごとの招待パスを結合してQRを自動生成する。
- 買い足しの厳密探索はブラウザーのWeb Workerへ移し、共有サーバーのCPUを長時間占有しない形にする。
- 開発・検証・本番を分離し、データ移行、バックアップ、監視、切り戻しまで整備する。

### 維持する機能

「ある／ない」の在庫、水・氷の常備品、kind_idによる代用、検索・度数フィルター、1杯ずつの注文、受付→提供完了、レシピの注文時スナップショット、注文再送の重複防止、注文の自動更新、QRのブランド表現を維持する。

### 初回リリースに含めないもの

複数バーの所有・共同管理者・課金・客人のGoogleログイン・公開バー検索・残量管理・キャンセル・イベント管理・ユーザーによる画像アップロード・音やプッシュ通知。受付停止はイベント管理とは別の単純な設定とする。

## Capabilities

### New Capabilities

- `host-accounts`: Firebaseでの登録・認証と所有権の検証。
- `tenant-data`: バー単位のデータ分離と既存データの移行。
- `bar-invitations`: 招待URL、QR、客人セッション、受付制御。
- `tenant-ordering`: 分離された在庫・注文・買い足し提案。
- `cloud-deployment`: Pages / Workers / D1の構成と公開運用。

### Modified Capabilities

既存の仕様と今回の要件を`openspec/specs/`へ統合した。家主認証・QRの自動生成・ブラウザー探索に関する旧要件は正規specで更新し、既存changeの履歴は維持する。対応はdesign.mdを参照。

## Impact

主な対象は`server/db.ts`、`server/app.ts`、`server/catalog.ts`、`server/index.ts`、CSV取り込み・バックアップCLI、`server/purchase-search.ts`、`src/main.tsx`、`src/api.ts`、`src/PurchaseSuggestions.tsx`、環境設定・テスト・README。詳細はdesign.md、実装順はtasks.mdを参照。
