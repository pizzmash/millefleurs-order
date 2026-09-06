# Milleflewrs — Home Bar

家にある材料から作れるカクテルを探し、客人が注文し、家主が提供するスマートフォン向けWebアプリです。Windows内のWSL2で動かし、自宅Wi-Fiから利用します。

## 初回セットアップ（WSL2）

クローン先の親ディレクトリから、プロジェクトへ移動します。

```bash
cd milleflewrs-order
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

## スマートフォンからの接続（Windows管理者設定）

スマホの `localhost` はスマホ自身を指すため、PCのLANアドレスを使います。PCからWSLへ接続できても、別端末からの接続は別途確認が必要です。

まずWSL側で実際のネットワーク方式を確認します。このアプリの標準ポートは3001番です。

```bash
wslinfo --networking-mode
```

`nat` の場合は、プロジェクトのルートでスクリプトのWindows側パスとディストリビューション名を確認してください。

```bash
wslpath -w "$(pwd)/scripts/Enable-Lan.ps1"
printenv WSL_DISTRO_NAME
```

アプリをWSL2で起動した状態で、Windowsの**管理者PowerShell**から次を実行します。山括弧の値は直前に取得した値に置き換えてください。

```powershell
$ScriptPath = '<スクリプトのWindows側パス>'
$Distro = '<WSLディストリビューション名>'
& $ScriptPath -Distro $Distro -Port 3001
```

このスクリプトはNATモードを確認し、WindowsのLANアドレスとWSLのアドレスを実行時に取得して3001番を転送します。さらに、そのアドレス・ポートに対するローカルサブネットからの通信をWindowsファイアウォールで許可します。既存の異なる転送設定は上書きしません。通常権限では実行できません。

複数のLANアドレスがある場合は、利用するネットワークの値を指定します。

```powershell
& $ScriptPath -Distro $Distro -Port 3001 -LanAddress '<PCのLANアドレス>'
```

PowerShellの実行ポリシーでスクリプトが許可されない場合は、組織・端末の方針に従ってください。ファイルを確認して必要な設定を手動で行うこともできます。

その後、スクリプトが表示した `Guest URL` をスマホから開き、QR参加→注文→家主の提供完了→客人の表示更新を確認します。このURLを `.env` のPUBLIC_URLにも設定する場合は、アプリを再起動してください。ゲストWi-Fiの端末間通信遮断が有効な場合は、PCに到達できるネットワークが必要です。

WSL再起動で内部IPが変わった場合、専用の古いルールを管理者PowerShellで削除してからスクリプトを再実行します。`<設定時のPCのLANアドレス>` には削除対象のルールに使った値を指定してください。他のアプリのルールは削除しないでください。

```powershell
netsh interface portproxy delete v4tov4 listenaddress='<設定時のPCのLANアドレス>' listenport=3001
```

本アプリ用のファイアウォールルールも不要になった場合は、次で削除できます。

```powershell
Remove-NetFirewallRule -Name Milleflewrs-HomeBar-3001
```

実際にmirroredモードへ変更する場合は、このNAT専用スクリプトは使いません。Windows/WSLの再起動や他アプリへの影響を考慮して、[Microsoftのネットワーク手順](https://learn.microsoft.com/en-us/windows/wsl/networking)に沿ってLAN・Hyper-Vファイアウォールを設定してください。

## 開発と検証

```bash
./scripts/npm.sh run dev           # Vite :5173 + API :3001
./scripts/npm.sh run test          # API・データの統合テスト
./scripts/npm.sh run build         # 型チェック + 本番ビルド
./scripts/npm.sh run spec:validate # OpenSpecの厳密検証
```

`start`と`dev`は同時に起動しないでください。APIのポートが競合します。開発中のPC確認は `http://localhost:5173` を使います。スマホには通常ビルド済みアプリの3001番を案内してください。

## データ・正規化・バックアップ

- コピー済みマスター: `data/raw/*.csv`（原本と同一。Git管理）
- コピー時の件数とSHA-256: `data/source-manifest.json`
- DB: `.runtime/bar.sqlite`（在庫・客人識別・注文履歴。Git対象外）
- 正規化: 空欄kind_id→null、度数→数値または範囲。表示名・分量は原表記を維持。
- 度数フィルターは原レシピの数値／範囲全体が指定条件に含まれるカクテルを表示し、不明を除外します。「8度以下」は0〜8の範囲であり、0%と確定したデータとは区別します。
- 同一kind_idの代用グループは元データに従います。

再取り込みは `./scripts/npm.sh run data:import`。在庫・注文履歴は保持され、アプリは毎回DBから参照します。注文には受付時のレシピ情報と使用材料を保存するため、後のマスター変更で履歴の名前・分量は変わりません。取り込み失敗はトランザクションで戻します。

```bash
./scripts/npm.sh run db:backup
```

SQLiteのバックアップAPIで `.runtime/backups/` に整合したコピーを作ります。復元はアプリを停止した状態で行い、現在のDBと付随するWAL/SHMファイルを退避してからバックアップをDBパスへ置いて再起動します。

## 実装範囲

React + Vite / TypeScript / Hono（Node.jsアダプター）/ Node.js標準SQLite。画面とAPIは単一サーバーから配信します。家主画面は合意どおり認証なしです。客人はブラウザーCookieで識別し、同じニックネームでも注文は混在しません。Cookieを削除した場合や別のブラウザーでは別の客人になります。

注文は「受付 → 提供完了」の2状態。客人側キャンセル、在庫残量の減算、会の開始・終了、カクテル個別非表示、通知音・プッシュ通知はありません。画面表示中は3秒間隔で自動更新します。

外部画像・Webフォントを取得できなくても、代替表示・ローカルフォントで操作できます。スマートフォン実機の接続確認はWindows管理者設定後に行ってください。詳細な実施状況は `VERIFICATION.md` に記録しています。
