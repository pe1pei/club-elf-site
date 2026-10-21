#!/bin/sh
# さくらのレンタルサーバへアップロードする（PHP 版）。
# 使い方: sh tools/deploy-sakura.sh [SSHホスト名] [公開フォルダ]
#   既定: ホスト clubelf（~/.ssh/config）/ 公開フォルダ www
# 本番データ（data/site.json・data/backups・uploads の画像）は dist-sakura に含まれないので上書きしない。
# アカウント（data/config.json）も本番側で追加・変更されるので上書きしない（サーバーに無いときだけ送る）。
#   PC で設定し直したアカウントを強制的に反映したいときは: FORCE_CONFIG=1 sh tools/deploy-sakura.sh
set -e
HOST="${1:-clubelf}"
DEST="${2:-www}"
cd "$(dirname "$0")/.."
node tools/build-sakura.js
# tar で固めて送り、サーバー側で展開（ドットファイル .htaccess も含む。config.json は除く）
tar -C dist-sakura --exclude=./data/config.json -cf - . | ssh -o BatchMode=yes "$HOST" "sh -c 'mkdir -p ~/$DEST && tar -xf - -C ~/$DEST && chmod 700 ~/$DEST/data && chmod 705 ~/$DEST/uploads'"
if [ -f dist-sakura/data/config.json ]; then
  if [ "$FORCE_CONFIG" = "1" ] || ! ssh -o BatchMode=yes "$HOST" "test -f ~/$DEST/data/config.json"; then
    ssh -o BatchMode=yes "$HOST" "sh -c 'cat > ~/$DEST/data/config.json.tmp && chmod 600 ~/$DEST/data/config.json.tmp && mv ~/$DEST/data/config.json.tmp ~/$DEST/data/config.json'" < dist-sakura/data/config.json
    echo "アカウント設定（data/config.json）を送りました"
  fi
fi
ssh -o BatchMode=yes "$HOST" "sh -c 'chmod 600 ~/$DEST/data/*.json'"
echo "アップロードしました: $HOST:~/$DEST"
