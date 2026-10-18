#!/bin/sh
# さくらのレンタルサーバへアップロードする（PHP 版）。
# 使い方: sh tools/deploy-sakura.sh [SSHホスト名] [公開フォルダ]
#   既定: ホスト clubelf（~/.ssh/config）/ 公開フォルダ www
# 本番データ（data/site.json・data/backups・uploads の画像）は dist-sakura に含まれないので上書きしない。
set -e
HOST="${1:-clubelf}"
DEST="${2:-www}"
cd "$(dirname "$0")/.."
node tools/build-sakura.js
# tar で固めて送り、サーバー側で展開（ドットファイル .htaccess も含む）
tar -C dist-sakura -cf - . | ssh -o BatchMode=yes "$HOST" "sh -c 'mkdir -p ~/$DEST && tar -xf - -C ~/$DEST && chmod 700 ~/$DEST/data && chmod 600 ~/$DEST/data/*.json && chmod 705 ~/$DEST/uploads'"
echo "アップロードしました: $HOST:~/$DEST"
