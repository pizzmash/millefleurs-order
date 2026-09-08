## Purpose

Webサービス版のbar-invitationsに関する動作と受け入れ条件を定義する。 家主と客人が複数のバーを利用しても情報が混在せず、安全に登録・参加・注文できるための境界条件を明確にする。

## Requirements

### Requirement: 正規URLからのQR生成
システムはPUBLIC_APP_URLと推測困難なバー別招待tokenから完全なinviteUrlを生成し、QRとコピー用リンクに同じ値を使うこと（SHALL）。

#### Scenario: お迎え画面を開く
- **WHEN** 公開URLと招待が有効である
- **THEN** URL入力なしでQRを表示し、デコード結果は招待パスを含む完全URLとなる。意匠・誤り訂正H・余白4モジュール以上を維持する。

#### Scenario: 本番設定が不正である
- **WHEN** PUBLIC_APP_URLが欠落、HTTP、localhost、またはパス・クエリー等を含む
- **THEN** 設定エラーとしてQRを表示せず、HostからURLを推測しない。

#### Scenario: stagingで招待する
- **WHEN** stagingでお迎え画面を開く
- **THEN** stagingのURL・招待・データを使い、本番へ接続しない。

### Requirement: バーに所属する客人セッション
システムは招待とニックネームで登録不要の参加を提供し、バーごとの客人セッションを使うこと（SHALL）。公開環境のCookieはHttpOnly・Secure・SameSite=Laxとしバー別APIパスに限定すること（SHALL）。

#### Scenario: 同じブラウザーで2つのバーへ参加する
- **WHEN** Aの参加後にBへ参加する
- **THEN** 両セッションが独立して維持され、他バーの注文を読み書きできない。

#### Scenario: 別端末で同じニックネームを使う
- **WHEN** 2端末が同名で参加する
- **THEN** 別guestとして自分の注文だけを見る。

#### Scenario: セッションが期限切れになる
- **WHEN** 発行から30日を過ぎたCookieでアクセスする
- **THEN** 401を返し、有効な招待からの再参加を案内する。

### Requirement: 招待再発行と受付停止
システムは招待再発行と受付ON/OFFを提供すること（SHALL）。再発行は旧招待・旧世代セッションを失効し、注文履歴を保持すること（SHALL）。

#### Scenario: 招待を再発行する
- **WHEN** 再発行後に旧リンクや旧Cookieが使われる
- **THEN** 参加・客人APIを拒否する。家主は既存注文を提供完了にできる。

#### Scenario: 受付を停止する
- **WHEN** 受付がOFFである
- **THEN** 新規参加・新規注文を拒否し、有効な客人の履歴閲覧と家主の提供完了は継続する。

#### Scenario: 受付を再開する
- **WHEN** 家主が受付をONへ戻す
- **THEN** 現在の招待と有効なセッションで参加・注文を再開できる。
