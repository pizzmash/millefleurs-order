## MODIFIED Requirements
### Requirement: Googleによる家主登録
システムはFirebase AuthenticationのGoogleサインインを使い、初回認証時に家主と所有バー1件を冪等に作成すること（SHALL）。新規バーの注文受付はONで開始し、既存バーの受付状態は維持すること（SHALL）。
#### Scenario: 初回ログインが並行する
- **WHEN** 同じ有効なUIDでbootstrapが同時送信される
- **THEN** ユーザーとバーは1件ずつ作られ、在庫は未登録、水・氷は常備品、受付はONになる
#### Scenario: 別端末で再ログインする
- **WHEN** 同じGoogleアカウントでログインする
- **THEN** 同じバーの在庫と注文が表示され、家主が選んだ受付状態は変更しない
#### Scenario: 停止済みバーの名前を保存する
- **WHEN** 家主がバーの名前を保存する
- **THEN** 受付状態を勝手にONにせず、設定済みの状態を維持する
