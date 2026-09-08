# Cloudflareへの公開と運用

構成はPages → Pages FunctionsのService binding → API Worker → D1。認証はFirebase Google。R2は使いません。実装とローカル検証はクラウドアカウントなしでも可能ですが、Googleログインと本番配備は実際のプロジェクト設定が必要です。

## ローカル開発

Node.jsは`.node-version`に合わせて24.20.0を使います。

```sh
npm ci
npm run cloud:setup:local
cp .env.example .env
npm run dev
```

`.env`のVITE_FIREBASE_*をFirebaseコンソールのWebアプリ設定で埋めます。APIのプロジェクトIDは`.dev.vars`（Git対象外）へ設定します。

```dotenv
FIREBASE_PROJECT_ID=your-firebase-project
```

ブラウザーは`http://localhost:5173`、APIはWranglerの8787番です。FirebaseでGoogleプロバイダーを有効化し、Authorized domainsへlocalhostを明示登録してください。Firebase Emulatorや認証バイパスは実装していません。テスト専用の検証関数差し替えは本番エントリーポイントから利用できません。

LANのスマホから開発確認する場合はAPI側の`PUBLIC_APP_URL`をそのLANオリジンに揃えます。開発HTTPだけCookieのSecureを外します。公開環境はHTTPS必須です。

## staging / productionの初期設定

各環境は別のPagesプロジェクト・API Worker・D1・Firebaseプロジェクトにします。

1. CloudflareへWranglerでログインするか、CIにデプロイ権限を限定したAPIトークンを設定します。
2. `npx wrangler d1 create <環境別DB名>`でD1を作成し、返されたdatabase_idを控えます。
3. `npx wrangler pages project create <環境別Pages名> --production-branch main`でPagesを作成します。
4. FirebaseへWebアプリを登録し、Googleプロバイダーを有効にします。Authorized domainsに公開画面のドメインを登録します。popup方式なので通常はFirebase標準のauthDomainをそのまま使います。
5. 以下を環境変数として設定し`npm run cloud:configure`を実行します。

| 環境変数 | 内容 |
| --- | --- |
| CLOUD_ENV | staging または production |
| CLOUDFLARE_ACCOUNT_ID | 所有するCloudflareアカウントのID |
| CLOUDFLARE_D1_ID | その環境のD1 database_id |
| CLOUDFLARE_PAGES_PROJECT | その環境のPagesプロジェクト名 |
| FIREBASE_PROJECT_ID | その環境のFirebase project ID |
| PUBLIC_APP_URL | 画面の正規オリジン。例: https://your-project.pages.dev |

生成結果は`.runtime/cloud/staging.worker.json`と`staging.pages.json`（productionも同様）です。API Workerには公開routeを設けず、workers.dev・preview URLも無効です。

## デプロイ

先にテスト・型・ビルド・specを通します。

```sh
npm test
npm run build
npm run spec:validate
npm run test:runtime
npm run test:browser
```

VITE_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_IDを対象環境の値で**シェルまたはCIにexport**して実行します。デプロイCLIはAPI側とブラウザー側のFirebase project一致を確認します。

```sh
npm run cloud:deploy -- staging
# stagingで疎通を確認してから
npm run cloud:deploy -- production
```

CLIはビルド→D1マイグレーション→カタログ投入→有効version切替→API Worker配備→Pages配備の順に実行し、途中失敗で停止します。デプロイはクラウドへ実際に書き込みます。既存のユーザー在庫や注文は初期化しません。

Pagesは任意パスの`--config`に対応していないため、配備CLIは一時ディレクトリに標準名の`wrangler.jsonc`と`functions/`を配置して実行します。ルートのAPI Worker設定は変更しません。

API Workerまで配備済みでPagesだけ失敗した場合は、同じ環境のビルド済み`dist`と生成済み設定を保持した状態で、Pagesのみ再実行できます（再ビルド・DB更新は行いません）。

```sh
npm run cloud:deploy:pages -- production
```

カタログ更新だけなら`npm run cloud:catalog`でSQLを生成し、対象Worker設定を指定してcatalog.sqlをD1に適用し、成功後にactivate-catalog.sqlを適用します。途中投入では旧versionを維持します。バージョンごとの古いカタログは復旧用に保持し、削除は別の管理作業として行います。

PRプレビューにはAPI Service bindingを設定しません。APIを使う動作検証は固定stagingで行います。PagesのGit自動配備を別途使う場合も、previewへ本番bindingを追加しないでください。

## 公開後の確認

- `/api/health`が200、未知のAPIがJSONの404、`/host/invite`などの直リンクが表示される。
- 家主A/BのGoogle登録・再ログイン・ログアウトで在庫と注文が分離される。
- 在庫登録→受付開始→QR参加→注文→代用品確定→提供完了をスマホSafari/Chromeで行う。
- 同一ブラウザーでバーA/Bを開いてもセッションが混ざらない。
- 受付停止と招待再発行の効果を確認する。再発行で既存客人は再参加が必要になる。
- 買い足し計算・在庫変更による結果失効・20秒制限をスマホで確認する。
- 家主が停止済みなら、そのバーの新規参加と客人APIも拒否する。

QRはPUBLIC_APP_URLと招待tokenから自動生成します。紙QRはドメイン変更に追従しないため、旧ドメインで同じパスへ転送するか再配布してください。

## 旧SQLiteの移行

移行先家主で一度ログインしてバーを作成し、受付OFF・在庫と注文が空のバーを選びます。旧アプリを停止して最終DBを取得します。最初はdry-runです。

```sh
npm run cloud:migrate-legacy -- --source /absolute/path/bar.sqlite --bar <移行先bar_id> --uid <Firebase UID>
# 内容確認後、ローカルバックアップとSQLを生成
npm run cloud:migrate-legacy -- --source /absolute/path/bar.sqlite --bar <移行先bar_id> --uid <Firebase UID> --write
```

生成した`.runtime/cloud/legacy-import.sql`を、対象環境のWorker設定で`wrangler d1 execute DB --remote --config ... --file ...`に渡します。バーと所有者のガードが一致しなければ失敗します。移行IDは元データ内容とバーから決まり、同じデータの再実行は重複しません。途中失敗時は**受付を停止したまま**同じSQLを再実行してください。legacy_importsの記録だけでは完了を意味しません。dry-runの件数と実データを比較してから受付を開始します。

旧客人の注文スナップショットを保持し、旧Cookieは移しません。新規客人は新しいQRから再参加します。本番が新しい注文を受けた後に旧SQLiteへ戻すとデータを失うため、単純な逆戻りは行いません。

## バックアップと復元

- 配備前と定期運用で`wrangler d1 export DB --remote --config <対象設定> --output <非公開の保存先.sql>`を実行し、Web配信ディレクトリに置きません。
- D1 Time Travelの保持期間は利用プランをCloudflareで確認し、運用記録へ残します。
- 別の検証用D1へexportを取り込み、在庫・注文件数と参照整合性を確認してから復元先へ切り替えます。
- カタログのみの不具合ならcatalog_stateを直前のversionへ戻せます。注文スナップショットは変更しません。
- API WorkerとPagesはCloudflareの過去デプロイへ切り戻せますが、DBは自動で戻りません。破壊的なマイグレーションは互換期間を置きます。
- 本番復旧時は受付停止→最新export→復元またはコード切り戻し→注文の差分確認→疎通→受付再開の順とします。

## 監視・制限・データ削除

APIはrequest IDを応答ヘッダーに付与し、予期しない失敗を機密を含まないJSONで記録します。アクセスURLに招待tokenがあるため、Cloudflareの自動リクエストログ永続化は既定で無効にしています。監視を有効化する際はURL、Cookie、Authorization、本文を保存しない設定を先に検証します。エラー調査には限定時間の`wrangler tail`とrequest IDを使い、共有前に機密を除きます。Cloudflareのリクエスト数・エラー率・CPU・D1読み書き数も確認します。

暫定レート制限は1分あたり家主240要求、招待解決/参加はIPごと120要求、参加はバーごと120要求、注文は客人ごと20要求。D1の原子的カウンターを使い、別インスタンスでも共有します。同一Wi-Fiの通常利用を妨げないかstagingで測定して調整します。429ではRetry-Afterを返します。期限切れセッションと古いカウンターは毎時削除します。

表示中のみ3秒でポーリングし、失敗時にバックオフします。1画面で複数APIを呼ぶため、実際の画面数・稼働時間からWorkers/D1の費用を見積もってください。

停止対応はD1のusers.statusをdisabledへ変更してからFirebase側を停止します。Firebase単独の失効は署名検証だけでは直ちに反映できません。データ削除は受付停止・ユーザー停止→sessions/orders/inventory/guests/legacy_imports→bars→usersの順で所属条件を指定して削除し、最後にFirebaseユーザーを削除します。共有カタログは削除しません。削除操作前に対象UID・bar_idを照合します。

公開前に注文履歴・バックアップの具体的な保持期間、削除依頼窓口と案内を確定してください。自動退会UIとクラウド上の定期exportスケジューラーは今回未実装です。

日本語フォントはFontsourceのNoto Sans/Serif JPをPagesへ同梱します。外部フォントサービスへリクエストしません。ライセンスはpublic/licensesに含めています。
