## Why

元CSVの画像URLでは画像が表示されないため、新しい配信先で画像が取得できるURLへ更新する。

## What Changes

- CSVの画像URLから新配信先と番号付きの候補を生成し、実際の画像GETで検証するスクリプトを追加する。
- 成功した行だけ画像URLを更新し、件数・候補別の結果を保存する。
- CSVのハッシュと更新前のハッシュを管理する。
- 再取り込み時に旧マスターと一致する注文履歴の画像URLも更新する。

## Capabilities

### New Capabilities

- `image-url-maintenance`: 画像URL候補の検証、成功行の書き戻し、結果の集計。

### Modified Capabilities

なし。

## Impact

data/raw/cocktail.csv、マニフェスト、取り込み処理、注文履歴の画像URL、更新用スクリプトとテスト。
