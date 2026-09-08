## ADDED Requirements

### Requirement: Cloudflareでの稼働
システムはPagesで画面、Service binding経由のWorkerでAPI、D1で構造化データを提供すること（SHALL）。HTTP処理はローカルディスクや常駐Nodeを前提にしないこと（SHALL）。

#### Scenario: 直リンクとAPI
- **WHEN** `/host/invite`や`/join/{token}`を直接開く
- **THEN** 画面を表示し、同一オリジンのAPIへ認証情報を中継する。未知のAPIはJSONの404を返す。

#### Scenario: Workerが再起動する
- **WHEN** 別インスタンスが次のリクエストを処理する
- **THEN** D1の在庫・注文・セッションを維持し、プロセスメモリーを権限や整合性の根拠にしない。

### Requirement: 環境と資格情報の分離
システムはstagingとproductionのデータ・認証・URL・bindingを分離し、秘密情報をブラウザービルドに含めないこと（SHALL）。

#### Scenario: PRプレビューを配備する
- **WHEN** プレビューが作成される
- **THEN** 本番DB・Workerへ接続せず、本番資格情報を使えない。

### Requirement: 公開APIの保護
システムはCookie認証の更新で許可Originを確認し、入力上限・分散レート制限を設け、個別データを共有キャッシュに保存しないこと（SHALL）。

#### Scenario: 別サイトから更新する
- **WHEN** Originが不一致または欠落している
- **THEN** Cookie認証の更新を拒否する。

#### Scenario: 過剰な参加・注文
- **WHEN** 設定した制限を超過する
- **THEN** 429とRetry-Afterを返し、別Workerインスタンスでも制限を適用する。

### Requirement: 画像の外部参照と代替表示
システムは既存の画像URLと静的ファイルを使用し、画像取得失敗時も注文操作を継続できること（SHALL）。R2を必須リソースにしないこと（SHALL）。

#### Scenario: 画像が取得できない
- **WHEN** 外部画像の取得に失敗する
- **THEN** 代替表示を使い、メニューと注文は利用できる。

### Requirement: 配備と復旧
システムは環境別配備、DBマイグレーション、復元手順、ログ・費用の確認方法を備えること（SHALL）。本番公開前にstagingで復旧と家主2名の分離を検証すること（SHALL）。

#### Scenario: 配備を切り戻す
- **WHEN** 以前のアプリ版へ戻す
- **THEN** DB互換性を確認し、新しい注文を失わない手順で復旧できる。
