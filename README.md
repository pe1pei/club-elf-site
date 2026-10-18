# キャバクラ ホームページ（管理画面つき）

Node.js だけで動きます（追加インストール不要）。

## 起動

```bash
node server.js
```

- 公開ページ: http://localhost:3200/
- 求人ページ: http://localhost:3200/recruit.html
- 管理画面:   http://localhost:3200/admin/ （初期パスワード `changeme`）

## 公開前に必ずやること

1. **管理パスワードを変える** — 環境変数 `ADMIN_PASSWORD` を設定して起動
   （例: `ADMIN_PASSWORD=好きな長いパスワード node server.js`）
2. **HTTPS で公開する** — レンタルサーバーやVPSのリバースプロキシ（nginx / Caddy 等）で SSL を付ける
3. ポートを変えたい時は `PORT=8080 node server.js`

## 管理画面でできること

| タブ | 内容 |
|---|---|
| 出勤 | サイトに出す/出さないの切替、**週ごと**の表入力（前週コピーあり）、**月ごと**のカレンダー入力（曜日まとめて入力あり） |
| キャスト | 追加・削除・並べ替え・写真・プロフィール・タグ・ひとこと、表示/非表示 |
| 料金 | 料金表（複数可）の項目・金額、注記 |
| トップ画像 | スライド画像（複数・並べ替え）、キャッチコピー、切り替え秒数 |
| 求人 | キャスト募集 / スタッフ募集（掲載ON/OFF、本文、待遇タグ、募集要項）、応募先（LINE・電話・メール） |
| 店舗情報 | 店名、電話、営業時間、定休日、補足、住所（→Googleマップ自動表示）、アクセス |
| 支店 | 系列店の追加・並べ替え |
| SNS | Instagram / X / TikTok / LINE / YouTube / その他 |
| デザイン | カラープリセット、アクセント色・背景色 |

- 右側のプレビューは**保存前の変更もその場で反映**されます。「PC / スマホ」で表示を切替。
- 「保存して公開」（Ctrl+S）で公開ページに反映。保存のたびに `data/backups/` に直前の状態を残します（最新30件）。
- 画像はブラウザ側で縮小してからアップロードされ、`public/uploads/` に保存されます。

## ファイル構成

```
server.js            サーバー（API・ログイン・画像保存）
data/site.json       サイトの中身（管理画面から編集される）
public/index.html    トップページ
public/recruit.html  求人ページ
public/site.js/.css  公開ページの描画とデザイン
public/admin/        管理画面
```

## 出勤のしくみ

- 日付ごとに「キャスト → 時間」を保存（`data/site.json` の `shifts`）。
- 深夜営業のため、**朝6時までは前日扱い**（出勤タブ下の「出勤の設定」で変更可）。
- 保存時に2か月より前の出勤データは自動で消えます。

## GitHub Pages で見る（お試し版）

GitHub Pages はファイルを置くだけの仕組みでサーバーが動かないため、**お試しモード**で動きます。

- 公開ページはそのまま表示されます（内容は `data/site.json`）。
- 管理画面も操作できますが、保存は**そのブラウザの中だけ**（他の人には見えません）。
- 本番運用（管理画面からの変更をみんなに公開）には、Node.js が動くサーバーで `node server.js` が必要です。

手順:
1. GitHub にリポジトリを作って push する
2. `.\deploy-pages.ps1` を実行（`public/` と `data/site.json` を `gh-pages` ブランチに反映。Settings → Pages は `gh-pages` ブランチ / root）
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で見られます（管理画面は末尾に `admin/`）

## SEO

- 管理画面の「SEO」タブで、検索結果のタイトル・説明文、トップの紹介文（ABOUT）、求人ページの文言、キーワード、価格帯を編集できます。
- 公開ページの HTML には、配信時（`server.js`）／書き出し時（`tools/build-pages.js`）に次を埋め込みます（`lib/seo.js`）:
  タイトル・説明文・OGP（LINE / X の共有表示）・canonical・構造化データ（NightClub：住所・電話・価格帯）
- `sitemap.xml` と `robots.txt` も自動で出ます。Google Search Console にサイトマップを登録してください。
- 見えない文字でキーワードを詰め込むのは Google の規約違反（順位低下・除外の対象）なので行いません。

## さくらのレンタルサーバで本番運用する（PHP 版）

さくらのレンタルサーバは Node.js の常駐が禁止なので、サーバー側を PHP にした版（`sakura/`）を使います。
画面（公開ページ・管理画面）は同じものです。PHP 8.1 以上が必要です（コントロールパネルで選択）。

1. **管理パスワードを決める**（入力は表示されず、`data/config.json` にハッシュだけ保存されます）
   ```
   node tools/set-password.js
   ```
2. **アップロード用フォルダを作る** → `dist-sakura/` ができます
   ```
   node tools/build-sakura.js
   ```
3. `dist-sakura/` の**中身**を、ドメインの公開フォルダ（例: `/home/アカウント名/www/ドメイン名/`）にアップロード
   （FTP / SFTP、またはコントロールパネルのファイルマネージャー。`.htaccess` などのドットファイルも忘れずに）
4. コントロールパネルで **常時SSL化（https）** を有効にする
5. `https://ドメイン/admin/` でログインし、SEO タブの「サイトのURL」を独自ドメインに変更して保存

- 本番で入力したデータは `data/site.json`、写真は `uploads/` に保存されます。どちらも `dist-sakura` に含まれないので、**コードを更新して再アップロードしても上書きされません**（初回だけ `data/site.default.json` から自動作成）。
- 保存のたびに `data/backups/` に直前の状態が30件まで残ります。
- `data/`・`lib/`・`templates/` は `.htaccess` で外から見えません。`uploads/` は画像以外を返しません。
- 手元での確認: `php -S localhost:3400 -t dist-sakura tools/php-router.php`
