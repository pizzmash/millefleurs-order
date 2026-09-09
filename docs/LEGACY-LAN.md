# 旧LAN版の運用記録

以下はWebサービス化前の手順です。現在のnpm run dev/startはクラウド版を起動します。旧サーバーを調査用途で起動する場合はnpx tsx server/index.tsを明示してください。現在のフロントエンドとの組み合わせはサポートしません。

## 初回セットアップ（WSL2）

クローン先の親ディレクトリから、プロジェクトへ移動します。

```bash
cd millefleurs-order
./scripts/setup.sh
```

プロジェクト内の `.runtime/` に固定バージョンのNode.jsとnpmを用意し、依存のインストール、CSV取り込み、ビルドを行います。既存のグローバルNode.jsは変更しません。Node.jsを自分で管理する場合は `.node-version` のバージョンを用意して、通常の `npm ci`、`npm run data:import`、`npm run build` でも構いません。

必要なら `.env.example` を `.env` にコピーし、Windows PCのLANアドレスを設定してください（`.env` はGit対象外）。

```dotenv
HOST=0.0.0.0
PORT=3001
DB_PATH=.runtime/bar.sqlite
# PUBLIC_URL=http://<PCのLANアドレス>:3001
```

`<PCのLANアドレス>` は利用するPCの値に置き換え、PUBLIC_URL行のコメントを外してください。PUBLIC_URLを省略した場合は、家主画面の「お迎え」で参加用URLを入力できます。

## 起動・停止

```bash
./scripts/npm.sh run start
```

- PC内の確認用: `http://localhost:3001`
- 家主画面: `/host`
- 客人画面: `/`
- 停止: 実行中のターミナルで `Ctrl+C`

最初に家主画面の「在庫」で材料を「ある」にしてください。実際の在庫は未入力で、サンプルの注文や在庫は登録していません。水と氷は常備品です。「お迎え」でQRコードを表示し、同じWi-Fiの客人に読み取ってもらいます。

## 買い足しの提案

家主画面の「在庫」で「買い足しで増やす」を開き、購入種類数の上限（1〜10、初期値5）を選んで「おすすめを計算」を押します。新たに作れるカクテル数が最大になる購入セットと、増えるカクテル・材料一覧を表示します。同じ増加数なら少ない購入数を優先します。

同じ種類で代用できる材料は1種類として数え、表示された候補のどれか1つを購入すれば満たせます。水・氷は常備品です。購入後は通常の在庫操作で「ある」に変更してください。

10種類の計算は数秒かかる場合があります。20秒で最大値を確定できなかった場合は購入種類数を減らして再試行してください。計算・表示後に在庫変更を検知すると再計算を案内します。

## スマートフォンからの接続

以下はNATモード用の手順です。アプリの標準ポートは3001番です。

### 1. WSLのターミナル：ネットワーク方式を確認

プロジェクトのルートディレクトリで実行します。

```bash
wslinfo --networking-mode
```

`nat` と表示されたら手順2へ進みます。すでに確認済みなら再実行は不要です。

`mirrored` の場合はこのNAT用手順を使わず、[Microsoftのネットワーク手順](https://learn.microsoft.com/en-us/windows/wsl/networking)でLAN・Hyper-Vファイアウォールの設定を確認してください。

### 2. WSLのターミナル：設定スクリプトの場所を確認

同じくプロジェクトのルートディレクトリで、次の2行を実行します。

```bash
wslpath -w "$(pwd)/scripts/Enable-Lan.ps1"
printenv WSL_DISTRO_NAME
```

1行目の結果は「スクリプトのWindows側パス」、2行目の結果は「WSLディストリビューション名」です。どちらも手順4で使うので控えてください。

### 3. WSLのターミナル：アプリを起動

すでに起動中なら、そのまま手順4へ進んでください。

```bash
./scripts/npm.sh run start
```

このターミナルはアプリを動かしたまま残します。

### 4. Windowsの管理者PowerShell：LAN接続を設定

Windowsのスタートメニューで「PowerShell」を検索し、「管理者として実行」を選びます。

次の山括弧の部分を、手順2で控えた値に置き換えて実行してください。値を囲むシングルクォートは残します。

```powershell
$ScriptPath = '<手順2の1行目の結果>'
$Distro = '<手順2の2行目の結果>'
& $ScriptPath -Distro $Distro -Port 3001
```

このスクリプトはPCとWSLのアドレスを取得し、3001番の転送と、ローカルサブネットからの通信を許可するファイアウォール設定を追加します。設定が完了すると `Guest URL` が表示されます。

### 5. スマートフォンのブラウザー：アクセスを確認

PCと同じ自宅Wi-Fiに接続し、手順4で表示された `Guest URL` を開いてください。

家主が「お迎え」画面にこのURLを入力すると、客人用のQRコードを表示できます。QR参加→注文→提供完了→注文状況の更新を確認してください。

### 設定で問題が出た場合

エラーが表示されたら、その手順で止めて内容を確認してください。

- 複数のLANアドレスが検出された場合：**Windowsの管理者PowerShell**で、利用するネットワークのアドレスを指定します。

```powershell
& $ScriptPath -Distro $Distro -Port 3001 -LanAddress '<PCのLANアドレス>'
```

- PowerShellの実行ポリシーでスクリプトが許可されない場合：端末の方針に従って実行方法を確認してください。
- スマホから接続できない場合：アプリが起動中か、同じWi-Fiか、ゲストWi-Fiで端末間通信が遮断されていないかを確認してください。

### WSL再起動後の転送設定の更新

WSLの内部IPが変わった場合は、**Windowsの管理者PowerShell**で本アプリ用の古い転送ルールを削除し、手順4を再実行します。山括弧には削除対象のルールに使った値を指定してください。

```powershell
netsh interface portproxy delete v4tov4 listenaddress='<設定時のPCのLANアドレス>' listenport=3001
```

### 本アプリ用ファイアウォール設定の削除

不要になった場合のみ、**Windowsの管理者PowerShell**で実行します。

```powershell
Remove-NetFirewallRule -Name Millefleurs-HomeBar-3001
```

## 開発と検証

以下はすべて、WSLのターミナルでプロジェクトのルートディレクトリから実行します。

```bash
./scripts/npm.sh run dev           # Vite :5173 + API :3001
./scripts/npm.sh run test          # API・データの統合テスト
./scripts/npm.sh run build         # 型チェック + 本番ビルド
./scripts/npm.sh run spec:validate # OpenSpecの厳密検証
```

`start`と`dev`は同時に起動しないでください。APIのポートが競合します。開発中のPC確認は `http://localhost:5173` を使います。スマホには通常ビルド済みアプリの3001番を案内してください。

## データ・正規化・バックアップ

- コピー済みマスター: `data/raw/*.csv`（画像URLは取得確認後に更新。Git管理）
- 現在の件数・SHA-256と画像URL更新前のハッシュ: `data/source-manifest.json`
- DB: `.runtime/bar.sqlite`（在庫・客人識別・注文履歴。Git対象外）
- 正規化: 空欄kind_id→null、度数→数値または範囲。表示名・分量は原表記を維持。
- 度数フィルターは原レシピの数値／範囲全体が指定条件に含まれるカクテルを表示し、不明を除外します。「8度以下」は0〜8の範囲であり、0%と確定したデータとは区別します。
- 同一kind_idの代用グループは元データに従います。

再取り込みは `./scripts/npm.sh run data:import`。在庫・注文履歴は保持され、アプリは毎回DBから参照します。注文には受付時のレシピ情報と使用材料を保存するため、後のマスター変更で履歴の名前・分量は変わりません。取り込み失敗はトランザクションで戻します。

```bash
./scripts/npm.sh run db:backup
```

SQLiteのバックアップAPIで `.runtime/backups/` に整合したコピーを作ります。復元はアプリを停止した状態で行い、現在のDBと付随するWAL/SHMファイルを退避してからバックアップをDBパスへ置いて再起動します。

## 画像URLの更新（WSLのターミナル）

画像の配信先が変わった場合は、プロジェクトのルートで実行します。

```bash
./scripts/npm.sh run data:update-images
./scripts/npm.sh run data:import
```

取得できた画像URLだけをCSVへ書き戻します。通常名と番号付きの候補を試し、失敗した行のURLは維持します。結果は `data/image-url-update-report.json` に保存します。詳しくは `data/README.md` を参照してください。

## 実装範囲

React + Vite / TypeScript / Hono（Node.jsアダプター）/ Node.js標準SQLite。画面とAPIは単一サーバーから配信します。家主画面は合意どおり認証なしです。客人はブラウザーCookieで識別し、同じニックネームでも注文は混在しません。Cookieを削除した場合や別のブラウザーでは別の客人になります。

注文は「受付 → 提供完了」の2状態。客人側キャンセル、在庫残量の減算、会の開始・終了、カクテル個別非表示、通知音・プッシュ通知はありません。画面表示中は3秒間隔で自動更新します。

外部画像・Webフォントを取得できなくても、代替表示・ローカルフォントで操作できます。スマートフォン実機の接続確認はWindows管理者設定後に行ってください。詳細な実施状況は `VERIFICATION.md` に記録しています。
