## Context

材料にはkindIdとstapleがある。現状はAPIの順序で常備品も表示する。

## Goals / Non-Goals

表示配列を加工し、買い足し計算に使う元データは保持する。

## Decisions

- 種類名順よりカタログのkindId順を採用する。nullは末尾、同種は日本語の材料名順、同名はID順にする。
- APIで除外せずUIの共通filterで常備品を除外し、計算に影響させない。
- 常備ラベルの描画分岐と画面内の常備説明を削除する。

## Risks / Trade-offs

検索時の除外漏れ → 共通filterで除外する。常備品の判定は既存テストで確認する。
