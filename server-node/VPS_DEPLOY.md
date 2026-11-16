# M2E Walk ポイントサーバー — VPS デプロイ手順書

2026-11-17 のユーザー決定（有料VPS路線）に基づく本線の手順書です。
Cloudflare Worker + D1 版（`../server/`）は予備として残します。

## 0. 前提・設置先

- 設置先は **既存の XServer VPS（4GB、ETH CAW ノードと同居）**。
  このサーバーは別用途のサービスが動いているので、本サーバーは
  専用ディレクトリ `/opt/m2e-walk`・専用ユーザー `m2e`・専用ポート
  **8787** を使い、既存サービスには一切触れません。
- ⚠️ **その VPS は 1 ヶ月プランで 2026-12-12 頃に期限・更新未定**です。
  ポイント台帳はお金の記録なので、**バックアップを VPS の外に
  必ず毎日出す**こと（§6）。台帳が VPS の中だけに存在する状態は禁止。
- OS 前提：Ubuntu 24.04。Node.js 24 を NodeSource から入れます
  （`node:sqlite` に必要。npm 依存パッケージはゼロ）。
- 所要時間の目安：SSH で入れる状態になってから **約15分**
  （インストール約5分＋秘密情報の設定約3分＋HTTPS 約5分＋疎通確認約2分）。

## 1. ユーザーに用意してもらうもの

1. **VPS の IP アドレス（またはホスト名）**
2. **SSH 公開鍵の登録**（こちらの公開鍵を VPS に登録してもらう。
   秘密鍵をチャットで送ることは絶対にしない。公開鍵だけを渡す）
   - XServer VPS の場合：コントロールパネルの「SSH Key」登録、または
     初回ログイン後に `~/.ssh/authorized_keys` へ追記。
3. **ドメインの有無**：独自ドメインがあれば §5-A（Caddy・本命）。
   無ければ §5-B（Cloudflare Tunnel で暫定運用）。

## 2. コードを VPS に置く

```bash
# VPS 上（SSH ログイン後）
sudo apt-get install -y git
git clone https://github.com/QL1-Infinite42-Guppy-Histoire/m2e-walk.git ~/m2e-walk
cd ~/m2e-walk/server-node
```

## 3. インストール

```bash
sudo bash deploy/install.sh
```

やること：Node 24 導入 → ユーザー `m2e` 作成 → `/opt/m2e-walk/server-node`
へ配置 → `.env` の雛形作成（600） → systemd ユニット登録・有効化。
`.env` が未記入の間はサービスを起動しません（意図した動作）。

ドメインがある場合は最初から HTTPS まで一気に：

```bash
sudo bash deploy/install.sh --with-caddy walk.example.com
```

（`walk.example.com` は実際のドメインに置き換え。DNS が VPS を
向いている必要があります。）

## 4. 秘密情報の設定（VPS 上で直接。チャットに値を書かない）

管理用シークレットの値は、この VM の以下のファイルにだけあります：

- `~/workspace/m2e-walk-server/ADMIN_SECRET.txt`
- `~/workspace/m2e-walk-server/GIFT_CODE_KEY.txt`

VPS の `/opt/m2e-walk/.env` を開き、両ファイルの値をそれぞれ
`ADMIN_SECRET=` / `GIFT_CODE_KEY=` に転記します（SSH の画面上で
コピー＆ペースト。チャットやリポジトリには絶対に貼らない）。

```bash
sudo nano /opt/m2e-walk/.env   # PORT/HOST/DB_PATH は既定のままでよい
sudo systemctl start m2e-walk
systemctl status m2e-walk
curl http://127.0.0.1:8787/health
# -> {"ok":true,"service":"m2e-walk","ssvEnabled":false}
```

## 5. HTTPS

アプリは平文 HTTP の URL を指せない（Android の制約＋トークン保護）
ため、公開 URL は必ず HTTPS にします。

### 5-A. 本命：独自ドメイン + Caddy（自動証明書）

1. ドメインの DNS A レコードを VPS の IP に向ける。
2. `deploy/install.sh --with-caddy <ドメイン>` を実行（または
   `deploy/Caddyfile.example` を `/etc/caddy/Caddyfile` に置いて
   `systemctl reload caddy`）。
3. 確認：`curl https://<ドメイン>/health` が 200 を返すこと。
   証明書は Caddy が Let's Encrypt から自動取得・更新します。

### 5-B. 暫定：Cloudflare Tunnel（ドメイン無しでも HTTPS URL が得られる）

```bash
# VPS 上
cloudflared tunnel --url http://127.0.0.1:8787
# -> https://<ランダム>.trycloudflare.com が発行される
```

注意：クイックトンネルの URL は再起動で変わります。パイロット前の
暫定確認用と割り切り、本番前に 5-A へ移行してください
（常設するなら名前付きトンネル＋ドメインが必要）。

## 6. バックアップ（必須・VPS の外へ）

台帳はお金の記録です。VPS の期限切れ・解約で消えたら復旧できません。

1. **VPS 上**（日次スナップショット）：
   ```bash
   sudo cp deploy/m2e-walk-backup.cron /etc/cron.d/m2e-walk-backup
   ```
   毎日 03:30 に `/opt/m2e-walk/backups/` へ一貫性のある
   スナップショット（VACUUM INTO）を作り、14 日分を保持します。
2. **VPS の外**（この VM やユーザーの PC から日次で取得）：
   ```bash
   bash deploy/pull-backup.sh <sshホスト> ~/m2e-walk-backups
   ```
   cron 化して自動化するのが望ましい（例は pull-backup.sh 内コメント参照）。
3. **復元**：サービスを止めて、スナップショットを DB_PATH の場所に
   コピーして起動し直すだけです。
   ```bash
   sudo systemctl stop m2e-walk
   sudo cp /path/to/m2e-walk-YYYYMMDD-HHMMSS.db /opt/m2e-walk/data/m2e-walk.db
   sudo chown m2e:m2e /opt/m2e-walk/data/m2e-walk.db
   sudo systemctl start m2e-walk
   ```

## 7. 疎通確認（デプロイ直後に必ず通す）

```bash
BASE=https://<公開URL>     # または http://127.0.0.1:8787（VPS 内確認用）

curl $BASE/health
# 登録（deviceToken が返る。以後の -H に使う）
curl -X POST $BASE/register -H 'content-type: application/json' -d '{}'
# 歩数レポート（15,000 歩 → 150pt）
curl -X POST $BASE/steps/report -H 'content-type: application/json' \
  -H "x-device-token: <deviceToken>" \
  -d "{\"deltaSteps\":15000,\"clientDate\":\"$(date +%F)\",\"elapsedMs\":7200000}"
# 残高（pending: 150 のはず）
curl $BASE/me -H "x-device-token: <deviceToken>"
# SSV は無効のまま 503 のはず
curl -w ' [%{http_code}]' "$BASE/admob/ssv?transaction_id=x&custom_data=y"
```

## 8. アプリ側の接続先差し替え（VPS の HTTPS URL が確定してから）

- 差し替え箇所は **1 か所だけ**：`app/app.json` の
  `extra.apiBaseUrl`（現在は暫定で `https://m2e-walk.nepicobsv.workers.dev`
  を指している）。
- 確定した VPS の HTTPS URL（例：`https://<ドメイン>`）に書き換えて
  アプリを再ビルドし、v0.2.0 として GitHub Release を出す。
- **向き先が存在しない URL を指す Release は作らない** — この差し替えと
  Release は、§7 の疎通確認が通ってから行います（今回の移植作業では
  未実施）。

## 9. 日常運用

| 操作 | コマンド |
|---|---|
| 状態確認 | `systemctl status m2e-walk` |
| ログ | `journalctl -u m2e-walk -f`（メソッド/パス/ステータスのみ記録。トークンは記録しない設計） |
| 再起動 | `sudo systemctl restart m2e-walk` |
| 更新 | VPS で `git pull` → `sudo bash deploy/install.sh`（コードだけ差し替わり、.env と data/ は保持される） |
| テスト | `cd server-node && npm test`（27 件：共有ロジック 23 + HTTP 統合 4） |

## 10. 残件（この手順書の範囲外）

- AdMob 登録（ユーザー作業）。完了するまで `/admob/ssv` は 503 のまま
  ＝ポイントは「確定」されません（設計どおり）。
- ギフト在庫の登録（公式購入＋暗号化登録）。在庫は空のまま運用開始可
  （承認時に在庫が無ければ `no_stock` になるだけ）。
- レート・月予算の最終承認（ユーザー）。数値は `src/config.js` にのみ
  あり、変更は再起動だけで反映されます。
