## Why

在庫登録で同じ種類を探しやすくし、操作不要な常備材料を省く。

## What Changes

- 種類ID順、同種内は日本語の材料名順、未分類は末尾にする。
- 常備材料を一覧から除外し、画面内の常備品説明も削除する。

## Capabilities

### New Capabilities

なし。

### Modified Capabilities

- `host-inventory`: 一覧の表示順と常備材料の非表示。

## Impact

在庫画面と買い足し提案の説明文。APIや在庫判定は変更しない。
