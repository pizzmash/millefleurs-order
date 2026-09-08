## Context

2026-09-08時点のコードを確認した。現行はReact / Vite + Hono Node.jsアダプター + `node:sqlite`で、画面とAPIを単一サーバーから配信する。

| 現状 | 移行後の設計案 |
| --- | --- |
| `/host`と`/api/host/*`に認証なし | Firebase IDトークンをAPIで検証 |
| `inventory`の主キーがdrink_idのみ | `(bar_id, drink_id)`で在庫を分離 |
| 客人Cookieと注文が単一家庭用 | バーに所属する参加情報とセッション |
| ローカルSQLiteと同期SQL | D1 bindingと非同期SQL |
| 起動時にCSVを自動取り込み | 明示的なマイグレーション・カタログ配備 |
| `PUBLIC_URL`または入力したLAN URLのルートをQR化 | `PUBLIC_APP_URL`と招待パスから自動生成 |
| 買い足し探索はNodeのsetImmediateで最大20秒 | ブラウザーのWeb Workerで厳密探索 |
| 画面表示中に3秒間隔で更新 | 表示中のみ継続、エラー時はバックオフ |

## Goals / Non-Goals

Goals: 家主ごとの確実なデータ分離、登録不要の客人体験、既存注文機能の維持、Cloudflareへの再現可能なデプロイ、環境をまたいだデータ混在の防止。

Non-Goals: proposal.mdの対象外機能。クラウド実装済みの項目と、公開設定待ちの項目はtasks.mdとdocs/DEPLOYMENT.mdで区別する。

## Decisions

以下はユーザー指定を具体化した設計提案であり、個別に合意済みという意味ではない。

### 1. 配信構成

```text
ブラウザー ── HTTPS ── Cloudflare Pages（Reactの静的ファイル）
   │                         └ /api/* → Pages Functions
   │                                              │ Service binding: API
   └ Firebase Authentication（Google）             ▼
                                            Hono API Worker
                                              └ DB: D1
```

- Pages Functionsはルートの中継のみ。API Workerが認証・認可・業務処理を担う。
- Workerは公開routeとworkers.devを無効化し、PagesからのService bindingで呼ぶ。中継はHTTPメソッド、本文、Authorization、Cookie、Set-Cookie、ステータスを保つ。
- ブラウザーは相対パス`/api/*`を使用する。別ドメインAPIとCookieのCORS設定を不要にする。
- `/api/*`以外はPagesが配信。SPAの直リンクはindex.htmlにフォールバックし、未知のAPIはJSONの404にする。
- Pages FunctionsもWorkersランタイムである。単一のPages FunctionsへAPIを統合する構成も可能だが、今回は明示的なPages + API Worker構成を基準とする。[Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- 別案はWorkers Static Assetsへの画面・API統合。デプロイ単位が減る利点があるが、ユーザー指定のPagesを無断で置き換えない。[公式移行ガイド](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)

### 2. アカウントと認証

1. `/`はサービス案内と家主ログインへの導線。`/host`以下はログインを必要とする。
2. Googleサインイン後、Firebase SDKのIDトークンを`Authorization: Bearer ...`で送る。
3. APIが署名（RS256・公開鍵のkid）、iss、aud、sub、exp、iat、auth_timeを検証し、対象FirebaseプロジェクトとGoogleプロバイダーであることを確認する。復号や単なるJWT decodeを検証として扱わない。
4. 検証済みsubをUIDとして`POST /api/host/bootstrap`でusersとbarsを作る。UNIQUE制約と原子的な処理により、初回アクセスが重複しても1ユーザー・1バーにする。
5. 再ログインでは同じUIDの在庫と注文を復元。メールアドレスを所有権キーにしない。

Workers互換のJWTライブラリーとWeb Cryptoを利用する。公開鍵はjoseのJWKSクライアントで最大1時間キャッシュし、未知のkidでは取得のクールダウンを守って更新する。署名検証用にサービスアカウント秘密鍵をフロントへ配布しない。[Firebase検証要件](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

Googleログインはクリック起点のpopupを初期案とし、ブロック・キャンセル時に再試行を案内する。スマートフォンのSafari/Chromeで検証する。redirect方式を採用する場合は、Cloudflare配信時の第三者ストレージ制限に対応するauth helper中継などを別途実装し、単純な置換では済ませない。[Googleサインイン](https://firebase.google.com/docs/auth/web/google-signin)、[redirectの注意点](https://firebase.google.com/docs/auth/web/redirect-best-practices)

401時はFirebase SDKで1回更新して再試行し、失敗すれば再ログインへ戻す。ログアウト・アカウント変更時は家主データ・購読・探索を消去する。アプリ内の`users.status`を毎回確認し、停止済みユーザーを即座に拒否する。Firebase管理画面だけでの無効化・トークン失効を署名検証だけで即時検知できるとは扱わない。運用上の停止はD1の停止を先に行い、Firebaseの停止を続ける。

### 3. データモデルと境界

初回は1家主1バー。UIDを全テーブルへ直接埋め込む代わりにbar_idを所有単位とする。将来の共同管理は別改修とし、今回はメンバー管理を作らない。

| テーブル | 主な項目・制約 | 所属 |
| --- | --- | --- |
| users | firebase_uid PK, display_name, status, created_at | アカウント |
| bars | id PK, owner_uid UNIQUE FK, name, accepting_orders, inventory_version, invite_version | 家主 |
| inventory | bar_id FK, drink_id FK, available; PK(bar_id, drink_id) | バー |
| bars内の招待情報 | invite_token UNIQUE, invite_version（再発行で更新） | バー |
| guests | id PK, bar_id FK, nickname, created_at; UNIQUE(bar_id, id) | バー |
| guest_sessions | token_hash PK, guest_id, bar_id, invite_version, expires_at | バー・客人 |
| orders | id PK, bar_id, guest_id, request_key, status, 受付時スナップショットと時刻 | バー・客人 |
| catalog_versions | id, source_hash, imported_at | 全体 |
| kinds / drinks / cocktails / recipes / techniques / glasses | 現行のカタログと安定ID | 全体 |

- 注文とセッションの`(bar_id, guest_id)`はguestsへの複合FK。注文の一意制約は`(bar_id, guest_id, request_key)`。
- インデックスはordersの`(bar_id, status, created_at, id)`と`(bar_id, guest_id, created_at, id)`など、実際のクエリーに合わせる。
- 家主のbar_idは検証済みUIDからサーバーで解決。リクエスト内のowner_uidやbar_idを権限根拠にしない。
- 客人のbar_idはCookieのセッションから解決し、URL中のbar_idと一致させる。別バーの注文IDを指定しても404。
- getDrinks/getCatalog/getMenu、代用品候補、件数集計、買い足し入力、注文更新を含め、全ての在庫依存処理にbar_idを明示する。
- 家主・客人の応答は`Cache-Control: no-store`。共有カタログ以外のキャッシュを他バーと共用しない。
- D1はbinding経由の非同期APIへ置換する。現在の`BEGIN IMMEDIATE`＋JSコールバックをそのまま移植しない。D1のbatchは原子的に実行可能だが、途中にJSの判定を挟めない。[D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- 在庫更新とinventory_version更新を同じbatchで実行。注文挿入は読み取った在庫version・カタログversion・受付状態・セッション有効性を条件とするSQLで確定し、競合時は409にする。既存request_keyの再送は同じ注文を返す。同じキーで異なる注文内容なら409。セッション失効は再送も拒否する。
- 完了・代用品更新もbar_idと状態をSQL条件に含める。アプリ上の事前チェックだけに依存しない。初回はD1のread replicationを使わず、導入する場合はSessionsによる読み取り整合性を再設計する。

### 4. 招待・客人・QR

- 初回バー名は「マイバー」で編集可能。新規バーは注文受付OFFとし、在庫登録後に家主がONにする。
- 有効な招待リンクはバーごとに1つ。暗号学的乱数で128bit以上の推測困難なtokenを発行し、`/join/{token}`を使う。UID・メール・連番だけで参加できる設計にしない。
- QR表示のため招待tokenは認証された家主のみ再取得可能とする。D1上のtokenは秘密として扱い、ログに記録しない。客人セッショントークンとは用途を分ける。
- 参加画面はバー名と受付状態を表示。客人がニックネーム（現行どおり1〜24文字）を入力すると、招待を検証してバーに所属するguestとセッションを発行する。
- URL中のtokenを外部へ送らないため参加画面は外部画像・解析を読み込まず、`Referrer-Policy: no-referrer`を指定。参加後は`/b/{barId}`へ履歴置換する。アクセスログの招待tokenもマスクする。
- Cookieは`HttpOnly; Secure; SameSite=Lax`、Domain属性なし、Pathは`/api/b/{barId}`。同じブラウザーで別バーに参加してもセッションを上書きしない。DBにはCookie値のハッシュを保存する。
- セッションは発行から30日で期限切れとする提案。同一バーの有効なセッションがあれば再利用し、別バーでは別guestにする。同じニックネームでも別端末は別guest。Cookie削除後の履歴復旧は初回対象外。
- 受付OFFでは新規参加・新規注文を拒否し、既存客人の注文履歴閲覧と家主の提供完了は継続する。受付再開で既存招待を再利用できる。
- 招待再発行ではinvite_versionを原子的に更新し、旧リンクと旧世代の客人セッションを失効する。以前の注文は保持する。家主UIには既存客人の再参加が必要になる旨を表示する。

#### 公開URLの決定

公開環境ではAPI Workerの`PUBLIC_APP_URL`を正規オリジンとして必須設定する。例は`https://bar.example.com`。`new URL('/join/' + token, PUBLIC_APP_URL)`でリンクを生成し、APIが完全なinviteUrlを返す。ブラウザーはその値をコピー・QR化する。

`window.location.origin`だけでもリンクを作れるが、プレビューURLや別名ドメインで開いた際に共有先がぶれる。長く使う招待には正規URLの明示が適する。本番URLはAPIのworkers.devではなく画面のドメインである。

- HTTPS・オリジンのみを許容し、ユーザー情報・パス・クエリー・fragment・localhostを公開設定で拒否する。末尾`/`は正規化してよい。
- 本番で未設定・不正なら設定エラーとし、HostやX-Forwarded-Hostから推測しない。家主のURL手入力欄は廃止する。
- ローカルのみHTTPと明示した開発オリジンを許可し、この場合のみCookieのSecureを外す。スマホ検証では到達可能なLAN URLを開発設定に指定する。
- 検証環境は固定URLを使う。任意のPRプレビューで招待を有効にする場合は、その環境専用のURL・API・データ接続を用意する。それ以外はログイン・招待などの動作検証を固定stagingへ誘導する。
- QRは現在の配色・余白4モジュール以上・誤り訂正Hを維持し、長くなった実URLでデコード検証する。ルートへの切り詰めを廃止する。
- ドメイン変更で既存の紙QRは自動更新されない。旧ドメインを維持して同じパスへ転送するか、QRを配り直す。tokenを維持すればパスは再利用できる。

### 5. APIと画面の境界

以下は移行後の契約案。命名の微調整は可能だが認証・所属境界は維持する。

| API | 権限・用途 |
| --- | --- |
| POST `/api/host/bootstrap` | Firebase認証、家主とバーを冪等作成 |
| GET/PATCH `/api/host/bar` | Firebase認証、バー名・受付状態 |
| GET `/api/host/inventory` / PUT `/api/host/inventory/:drinkId` | Firebase認証、自分の在庫 |
| GET `/api/host/orders` | Firebase認証、自分のバーの注文 |
| PUT `/api/host/orders/:id/ingredients/:recipeId` | Firebase認証、代用品確定 |
| POST `/api/host/orders/:id/complete` | Firebase認証、提供完了 |
| GET `/api/host/invitation` | Firebase認証、現在のinviteUrlとQR用情報 |
| POST `/api/host/invitation/rotate` | Firebase認証、旧リンク・セッション失効 |
| GET `/api/host/purchase-input` | Firebase認証、在庫・カタログ・各version |
| POST `/api/invitations/resolve` | tokenを本文で検証し、参加先と受付状態のみ返す |
| POST `/api/b/:barId/join` | token・nicknameで参加、Cookie発行 |
| GET `/api/b/:barId/session` | 客人セッション確認 |
| GET `/api/b/:barId/menu`, `/cocktails/:id` | 客人セッション、当該バーの作成可否 |
| GET/POST `/api/b/:barId/orders` | 客人セッション、自分の履歴・新規注文 |
| GET `/api/health` | 機密を含まない生存確認 |

旧`/api/menu`・`/api/orders`などを単一バーへ暗黙フォールバックさせない。廃止APIは404を返す。家主は客人参加せず在庫・注文を管理できる。

Cookie認証の更新操作はJSONのみとし、Originを環境の許可オリジンと厳密照合する。Origin欠落・不一致は拒否する。Pages中継が渡す任意ヘッダーを所有者認証に使わない。招待解決・参加・注文は分散環境で効くレート制限を設け、超過は429とRetry-After。入力の32KiB上限と検証を維持する。レートキーにIPだけを使うと同一Wi-Fiの全客人が衝突するため、招待・セッション単位の制限も組み合わせる。

### 6. 買い足し提案と自動更新

現在の探索は最大20秒のCPU負荷とプロセス内フラグに依存する。Workersの制限は経過時間とCPU時間を区別する必要がある。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

推奨案では純粋な探索アルゴリズムを共有モジュールへ分け、家主ブラウザーのWeb Workerで実行する。Node専用のsetImmediateを切り離す。1〜10・初期値5、最適性、20秒打ち切り、未確定解を出さない条件は維持する。メインスレッド側のタイマーで停止し、ログアウト・画面離脱・在庫変更でキャンセルする。

計算前に所有バーの入力とinventory_version/catalog_versionを取得し、結果表示前にサーバーの最新versionと照合する。照合失敗・変更時は結果を出さず再計算を案内する。探索は同一画面で1件とし、他の家主や他端末をブロックしない。サーバーはブラウザーの結果を在庫更新・注文の根拠にしない。スマホで遅い場合も最適解と偽らず上限を減らす案内をする。サーバー探索を残す場合は有料枠を含むCPU実測・分散排他の別設計が必要。

注文の自動更新は当面3秒間隔を維持し、非表示タブで停止、失敗時に指数バックオフ＋ジッター、再表示時に即取得する。認証失効後は停止。100画面が1エンドポイントを常時表示すると約288万リクエスト/日になるため、実際の画面当たりAPI数と稼働時間から費用を見積もる。WebSocket化は初回対象外。

### 7. 画像とカタログ

ユーザーの指示によりR2は使用しない。カクテル画像は既存の外部URLを維持し、取得失敗時はSVGアイコンへフォールバックする。固定ファイルはPagesへ同梱する。招待画面は外部画像・Webフォントを読み込まない。

カタログはCLIで既存CSVの検証・正規化処理を再利用し、D1のcatalog_drinks/catalog_entries/catalog_kindsへversion付きで分割投入する。各カクテルはJSONの独立した行とし、catalog_stateのversionを最後に切り替える。投入失敗時は旧versionを維持する。drinksは在庫FK用の安定ID台帳とする。未分類や分量、度数範囲の意味は維持する。

### 8. 環境設定

| 設定 | 配置 | 内容 |
| --- | --- | --- |
| `PUBLIC_APP_URL` | API Workerの環境変数 | 公開画面の正規オリジン、公開環境で必須 |
| `APP_ENV` | API Workerの環境変数 | local / staging / production |
| `FIREBASE_PROJECT_ID` | API Workerの環境変数 | IDトークンのaud/iss検証対象 |
| `VITE_FIREBASE_API_KEY` | Pagesビルド環境 | Firebaseクライアント設定 |
| `VITE_FIREBASE_AUTH_DOMAIN` | Pagesビルド環境 | Firebase authDomain |
| `VITE_FIREBASE_PROJECT_ID` | Pagesビルド環境 | API側と一致するプロジェクト |
| `VITE_FIREBASE_APP_ID` | Pagesビルド環境 | Firebase WebアプリID |
| `API` | Pages Service binding | 環境別API Worker |
| `DB` | Worker D1 binding | 環境別DB |
| `CLOUDFLARE_API_TOKEN` / account ID | CIの設定・Secrets | 最小限のデプロイ権限 |

FirebaseのWeb設定はブラウザーへ配布される前提であり、これを認可の秘密にしない。サービスアカウント資格情報・Cloudflare API tokenを`VITE_*`に入れない。公開環境ではFirebase Emulatorを許可しない。

stagingとproductionはPagesプロジェクト・Worker・D1・Firebaseプロジェクトを分離する提案。PRプレビューは本番binding・資格情報に接続しない。FirebaseのAuthorized domainsへ固定staging、本番、必要なローカルドメインを明示登録する。Pagesビルド設定の変更には再ビルドが必要。Worker設定のみ変更してもブラウザーのFirebase設定は変わらない。

### 9. デプロイ・移行・復旧

実装順はtasks.mdを参照。公開までの基本手順は以下。

1. 環境別リソース、Firebase Googleプロバイダー、許可ドメイン、Secretsを設定する。
2. D1の前方互換マイグレーションを適用し、検証済みカタログを配備する。
3. API Workerを配備し、正しいDB・PUBLIC_APP_URL・Firebase projectを確認する。
4. Pagesへ環境別Service bindingとFirebaseビルド設定を設定して配備する。
5. stagingで家主2名・客人複数・スマホのQR参加から提供完了まで確認する。
6. 本番を同じ手順で配備し、TLS、直リンク、認証、データ分離、受付停止を確認する。

現行SQLiteは新規登録ユーザー全員へコピーしない。移行対象の家主UID・bar_idを明示した管理用CLIを用意し、dry-run、元DBバックアップ、件数・整合性確認、移行IDによる再実行時の重複防止を設ける。推奨は既存の在庫・注文履歴を1バーに移すこと。旧guestの履歴用レコードは保存するが旧Cookieの認証資格は移行せず、新しいQRから参加し直す。マスターだけで開始する選択もdiscussion.mdで整理する。

切り替え時は旧サーバーを停止して最終スナップショットを取得し、二重書き込みを避ける。本番で新しい注文を受けた後は旧SQLiteへ単純に戻すと注文を失うため、受付停止・差分退避を行ってから復旧する。

D1 Time Travelと環境外への定期exportを使った復旧手順を作成する。利用プランの保持期間を運用手順に記録し、別DBへの復元リハーサルを実施する。exportはアクセス制限した運用端末等へ保管し、Web配信先へ置かない。[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

Worker/Pagesの以前の互換バージョンへの切り戻しと、DBの復元を分ける。D1の破壊的スキーマ削除は互換期間後に行い、コードのロールバックだけでDBが戻るとは扱わない。構造化ログでrequest ID、エラー種別、応答時間を確認できるようにし、IDトークン・Cookie・招待token・ニックネームを記録しない。

### 10. 旧仕様との対応と統合方針

| 既存change / capability | 今回の扱い |
| --- | --- |
| add-home-cocktail-ordering / host-inventory | tenant-data / tenant-orderingの所有バーに限定 |
| 同 / guest-ordering | bar-invitations / tenant-orderingで参加・注文を分離 |
| 同 / host-order-management | Firebase認証と所有権チェックを追加 |
| 同 / cocktail-catalog, cocktail-availability | カタログは共有、在庫依存判定はバー単位 |
| style-invitation-qr / invitation-qr | 手入力・ルートURL化を廃止。意匠は維持 |
| add-purchase-recommendations | 厳密性を維持し、20秒探索と排他の実行場所をブラウザーへ変更 |
| refresh-cocktail-image-urls | 外部URL更新CLIを維持し、更新後にカタログを再配備 |

正規specへ統合し、旧来の「認証なし」「LANのみ」「会の開始終了なし」と新しい受付設定の関係、QRの入力欄、サーバー全体の探索排他を更新した。現行の開発エントリーポイントはクラウド版へ変更する。旧NodeサーバーはCSV検証・移行元として保持する。

## Risks / Open Questions

未確定事項と推奨値はdiscussion.mdに集約。特にデータ移行範囲・画像用途・ドメイン・予算は公開準備までに確定する。数値制限や料金は固定の保証とせず、実装・デプロイ時に公式情報と実測を再確認する。
