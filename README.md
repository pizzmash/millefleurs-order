# Millefleurs — Home Bar

**自宅の在庫を、客人が注文できるカクテルメニューに。**

Millefleursは、ホームバーでの「何が作れる？」「何を飲む？」をつなぐWebアプリです。家主が手持ちの材料を登録すると、客人は招待QRから参加し、作れるカクテルを選んで注文できます。家主はGoogleアカウントでログインし、客人はニックネームだけで参加します。

React / TypeScriptで画面を構築し、Cloudflare Pages・Workers・D1とFirebase Authenticationで動作します。

## 目次

- [主な機能](#主な機能)
- [使い方](#使い方)
- [アーキテクチャ](#アーキテクチャ)
- [クイックスタート](#クイックスタート)
- [開発と検証](#開発と検証)
- [デプロイと運用](#デプロイと運用)
- [ディレクトリ構成](#ディレクトリ構成)
- [カタログと画像](#カタログと画像)
- [トラブルシューティング](#トラブルシューティング)
- [コントリビューション](#コントリビューション)
- [ライセンス](#ライセンス)

## 主な機能

| 機能                 | できること                                                                       |
| -------------------- | -------------------------------------------------------------------------------- |
| 在庫とメニュー       | 材料の有無から作成可能なカクテルを判定。同じ種類の材料による代用にも対応         |
| QRで招待             | バーごとの招待QRを発行し、登録不要で客人を受け入れ                               |
| 注文管理             | 客人が1杯ずつ注文し、家主が内容を確認して提供完了に更新                          |
| 買い足し提案         | 購入する材料の種類数を指定し、新しく作れるカクテル数を最大化する組み合わせを探索 |
| バーの管理           | バー名の変更、受付の開始・停止、招待の再発行                                     |
| バーごとのデータ分離 | 1家主につき1バーを作成し、在庫・注文・招待を分離                                 |

### 利用上のルール

- 在庫は「ある／ない」で管理します。注文による残量の減算は行いません。
- 水・氷は常備品です。同じ有効な`kind_id`を持つ材料は代用できます。
- 注文の状態は「受付 → 提供完了」です。客人によるキャンセル、決済、音・プッシュ通知はありません。
- 注文には受付時のレシピを保存します。
- 買い足し提案の上限は1〜10種類（初期値5）。探索が20秒以内に完了しない場合は、種類数を減らして再計算します。

## 使い方

1. **家主が準備する** — Googleでログインし、「在庫」で手持ちの材料を登録します。
2. **客人を招く** — 「お迎え」で受付を開始し、表示された招待QRを共有します。
3. **客人が注文する** — QRからアクセスし、ニックネームを入力してカクテルを選びます。
4. **家主が提供する** — 注文内容を確認し、必要に応じて代用品を確定して、提供完了にします。
5. **受付を終了する** — 「お迎え」で受付を停止します。招待を再発行すると、既存の客人も再参加が必要になります。

自分のPCで試す場合は、家主のブラウザーとは別のブラウザープロファイルで招待URLを開くと、客人としての操作を確認できます。

## アーキテクチャ

```text
ブラウザー（React + Vite）
  ├─ 家主のGoogleログイン ───────── Firebase Authentication
  ├─ 買い足し計算 ──────────────── ブラウザー内のWeb Worker
  └─ /api/* ─ Cloudflare Pages Functions
                 └─ Service binding ─ API Worker（Hono）─ D1
```

Pagesが画面を配信し、Pages FunctionsからService bindingでAPI Workerを呼び出します。WorkerはFirebaseのIDトークンを検証し、在庫・注文・セッションをD1へ保存します。客人はバー別のCookieで識別します。画像は外部URLを参照し、R2は使用しません。

ローカル開発ではViteが画面を配信し、`/api`をWranglerのAPI Workerへプロキシします。

## クイックスタート

### 前提条件

- Git
- Node.js **24.20.0**（[.node-version](.node-version)に合わせる）とnpm
- Googleログインを有効にしたFirebaseプロジェクトとWebアプリ

ローカルD1の初期化や自動テストにCloudflareアカウントは不要です。画面から家主として利用するにはFirebaseの実設定が必要です。Firebase Emulatorや認証バイパスは実装していません。

### 1. 取得と依存関係の導入

```sh
git clone https://github.com/pizzmash/millefleurs-order.git
cd millefleurs-order
npm ci
```

以下はPOSIXシェルの例です。WindowsではWSLから実行できます。

### 2. ローカルデータベースの準備

```sh
npm run cloud:setup:local
```

D1のマイグレーション、CSV由来のカタログSQL生成・投入、有効バージョンの切り替えを行います。生成ファイルは`.runtime/`、ローカルD1は`.wrangler/`に保存され、どちらもGit管理対象外です。

### 3. Firebaseの設定

FirebaseコンソールでWebアプリを登録し、AuthenticationのGoogleプロバイダーを有効にします。Authorized domainsには`localhost`を明示的に追加してください。

```sh
cp .env.example .env
```

`.env`を開き、Webアプリの設定値を入力します。

```dotenv
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=your-web-app-id
```

続いて、リポジトリ直下に`.dev.vars`を作成します。

```dotenv
FIREBASE_PROJECT_ID=your-project
```

`FIREBASE_PROJECT_ID`は`.env`の`VITE_FIREBASE_PROJECT_ID`と同じ値にします。`.env`はブラウザー用、`.dev.vars`はAPI Worker用の設定です。どちらもGit管理対象外です。Firebaseサービスアカウントの秘密鍵は使用しません。

### 4. 起動と確認

```sh
npm run dev
```

[http://localhost:5173](http://localhost:5173)を開きます。ViteとAPI Worker（ポート8787）が同時に起動します。APIの起動確認には[http://localhost:5173/api/health](http://localhost:5173/api/health)を開き、HTTP 200が返ることを確認してください。その後、Googleでログインし、在庫の登録に進みます。

スマートフォンからのLAN接続では、`localhost`をそのまま利用できません。API側の`PUBLIC_APP_URL`などの設定は[ローカル開発の詳細](docs/DEPLOYMENT.md#ローカル開発)を参照してください。

## 開発と検証

### よく使うコマンド

| コマンド                | 用途                                                  |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | ViteとローカルAPI Workerを起動                        |
| `npm run build`         | TypeScriptの型検査と画面の本番ビルド                  |
| `npm test`              | 自動テスト                                            |
| `npm run format:check`  | ソースコードのPrettierチェック                        |
| `npm run format`        | ソースコードの整形                                    |
| `npm run spec:validate` | 全OpenSpec仕様・changeの厳密検証                      |
| `npm run cloud:catalog` | CSVからD1投入用SQLを生成（DBへの適用は別途必要）      |
| `npm run test:runtime`  | Worker・Pages Functionsのビルドとランタイム統合テスト |
| `npm run test:browser`  | ビルドとPlaywrightによるブラウザーテスト              |

基本の検証は次のとおりです。

```sh
npm test
npm run build
npm run spec:validate
npm run format:check
```

ランタイムや画面を変更した場合は、以下も実行してください。ブラウザーテストにはChromiumとOSの依存ライブラリが必要です。

```sh
npx playwright install --with-deps chromium
npm run test:runtime
npm run test:browser
```

[GitHub Actions](.github/workflows/check.yml)では整形・テスト・OpenSpec・ランタイム・ブラウザーの検証を実行します。自動テストに加えて、実際のGoogleログインやスマートフォンでの動作は対象環境で確認してください。[検証記録](VERIFICATION.md)には過去の確認結果と制約を記載しています。

### OpenSpecでの変更管理

現行仕様は[openspec/specs](openspec/specs)、変更提案・設計・タスクは[openspec/changes](openspec/changes)にあります。

```sh
npx openspec new change <change-name>
npx openspec status --change <change-name>
npx openspec instructions proposal --change <change-name>
```

CLIの案内に沿って提案・必要な差分仕様・設計・タスクを整え、実装と検証を進めます。動作変更を伴わない文書のみのchangeは`.openspec.yaml`に`skip_specs: true`を設定できます。提出前に`npm run spec:validate`で整合性を確認してください。

## デプロイと運用

公開先にはCloudflareのPages・API Worker・D1と、Firebaseプロジェクトを用意します。設定の生成、staging / productionへの配備、旧SQLiteからの移行、バックアップと復元は[公開・運用手順](docs/DEPLOYMENT.md)を参照してください。

GitHub Actionsには、**mainへのpushで検証成功後に本番へ自動配備する設定**があります。利用にはGitHubの`production` Environmentへの変数・Secret登録が必要です。PR・他ブランチでは検証のみを行います。APIを含む動作確認には固定stagingを利用し、PRプレビューには本番APIのbindingを追加しない構成です。

## ディレクトリ構成

```text
src/                 React画面・認証・ブラウザー内の買い足し計算
worker/              API Worker・認証検証・D1アクセス
functions/           Pages FunctionsからAPIへの中継
shared/              共通の型・ドメインロジック
migrations/          D1のスキーマ変更
scripts/cloud/       カタログ生成・設定・デプロイ・旧DB移行
server/              CSV取り込み共通処理と旧LAN版サーバー・CLI
data/                カタログCSV・取得記録
public/licenses/     同梱フォントのライセンス
tests/               自動テスト・ランタイム・ブラウザー検証
openspec/            現行仕様と変更履歴
docs/                公開運用手順・旧LAN版の記録
```

旧LAN版の調査には[LEGACY-LAN.md](docs/LEGACY-LAN.md)を参照してください。`data:import`・`db:backup`は旧SQLite向けで、現行D1の初期化・バックアップには使いません。

## カタログと画像

カクテルと材料のマスターは[data/raw](data/raw)のCSVで管理します。[source-manifest.json](data/source-manifest.json)には件数とSHA-256を記録しています。現行版では`npm run cloud:catalog`でバージョン付きSQLを生成し、D1へ投入して有効バージョンを切り替えます。反映手順は[公開・運用手順](docs/DEPLOYMENT.md)を参照してください。

画像はCSVに含まれる外部URLを使用し、読み込めない場合はアイコンを表示します。画像ファイル自体はリポジトリへ保存しません。正規化方針と画像URLの更新履歴は[data/README.md](data/README.md)にあります。同資料内のSQLiteへの取り込み手順は旧LAN版向けです。

## トラブルシューティング

| 症状                                               | 確認すること                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 「ログイン設定がまだ完了していません」と表示される | `.env`の4つの`VITE_FIREBASE_*`がすべて設定されているか。変更後は開発サーバーを再起動        |
| Googleログインに失敗する                           | FirebaseのGoogleプロバイダー、Authorized domainsの`localhost`、ブラウザーのポップアップ設定 |
| ログイン後のAPI呼び出しに失敗する                  | `.dev.vars`と`.env`のFirebase project IDが一致するか。変更後は開発サーバーを再起動          |
| APIに接続できない／カタログが表示されない          | ターミナルのWranglerエラー、`/api/health`、`cloud:setup:local`が成功したか                  |
| 起動時にポート使用中と表示される                   | 5173と8787を別のプロセスが使用していないか                                                  |
| 客人が参加できない                                 | 家主が受付を開始しているか、再発行前の招待URLを使っていないか                               |

## コントリビューション

不具合報告・改善提案は[Issues](https://github.com/pizzmash/millefleurs-order/issues)へお願いします。不具合には再現手順、期待する動作と実際の結果、OS・ブラウザー・Node.jsのバージョンを添えてください。ログや画像から、認証トークン、Cookie、招待URL、個人情報を取り除いてください。

変更を提案する場合は、次の流れでPRを作成してください。

1. 変更の目的をIssueまたはOpenSpecのproposalに記載する。
2. 作業ブランチで実装・文書を更新し、動作変更はOpenSpecへ反映する。
3. 変更に応じた検証を実行し、関連するタスクを更新する。
4. PRに変更内容、関連するchange、検証結果、未確認事項を記載する。

ライセンスの設定状況は次項を確認してください。

## ライセンス

**プロジェクト本体のライセンスは未設定です。** 現時点ではOSSライセンスによる利用・改変・再配布の許諾を明示していません。OSSとして公開する際は、権利者がライセンスを選定し、LICENSEファイルを追加する必要があります。

カタログCSV・外部画像についても、取得・参照できることと再配布の許諾は別です。公開前に取得元の利用条件・権利・必要なクレジットを確認してください。

同梱するNoto Sans JP・Noto Serif JPのライセンスは[public/licenses](public/licenses)に収録しています。依存パッケージには各パッケージのライセンスが適用されます。
