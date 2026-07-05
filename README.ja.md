# Even Terminal Launcher

[English](./README.md)

![Even Terminal Launcherの画面イメージ](./docs/images/even-terminal-launcher-social-1200x630.png)

_説明用のモックアップです。プロファイル、パス、アドレス、port、ログの値は
架空のものです。_

macOSのメニューバーまたはWindowsのタスクトレイから
[`@evenrealities/even-terminal`](https://www.npmjs.com/package/@evenrealities/even-terminal)
の接続プロファイルを管理する、非公式のデスクトップランチャーです。

本ランチャーは3mintimerが個人で開発・保守している非公式プロジェクトです。
Even Realitiesの公式製品ではなく、同社との提携や同社による推奨を示すものでも
ありません。

## プロジェクトの運用方針

本プロジェクトは、作者自身が利用するために個人で保守しています。現在、
Pull Request、機能要望、一般的なサポートは受け付けていません。MIT Licenseの
対象となるコードは自由にforkし、それぞれの環境で保守して利用できます。

ブランド資産はMIT Licenseの対象外であり、fork先で差し替えるか、コードとは
分けて扱う必要があります。セキュリティ上の報告については
[セキュリティポリシー](./SECURITY.md)を参照してください。

## 現在の状態

- **macOS Apple Silicon:** ローカル検証済みです。
- **Windows:** 実装、CI、unsigned packageは準備済みですが、Windows実機での
  受け入れ確認は未実施です。
- **一般配布:** まだ行っていません。現在のmacOS packageはローカルテスト用の
  ad-hoc署名です。
- **Linux:** 現在の対応範囲外です。

検証範囲の詳細は
[Windows readiness](./docs/platform/windows-readiness.md)を参照してください。

## 主な機能

- メニューバー／トレイから複数のEven Terminalプロファイルを管理
- Claude CodeまたはCodex、作業ディレクトリ、HTTP port、Codex app-server
  portをプロファイルごとに設定
- port競合の検出と、起動・health check・再起動・停止の監視
- Electron `safeStorage`によるbridge tokenの保存
- LAN、Tailscale表示アドレス、指定interface、対応tunnel helperへの接続
- ログと診断情報からのtoken redaction
- 分離されたEven Terminal runtimeの確認、導入、切替、rollback
- tokenと実行ファイルoverrideを含まないprofile設定のexport/import
- 日本語、英語、簡体字中国語、繁体字中国語、韓国語、スペイン語UI

## 必要なもの

- Node.js 24.18.0（[`mise.toml`](./mise.toml)で固定）
- npm
- インストールと認証が済んだ`claude`または`codex`コマンド
- 実機接続を行う場合はEven Realities G2とEven app

初期runtimeとしてEven Terminal 0.8.1を同梱します。

## ソースから起動

```bash
git clone <repository-url>
cd even-hub-launcher
mise install
mise exec -- npm ci
mise exec -- npm run dev
```

`mise`を使わない場合はNode.js 24.18.0を導入し、npmコマンドを直接実行して
ください。

## 基本的な使い方

1. ランチャーを起動します。macOSではメニューバーに常駐します。
2. ランチャー画面を開き、プロファイルを新規作成します。
3. Claude CodeまたはCodexを選び、作業ディレクトリを指定します。
4. 提案されたHTTP portとCodex app-server portを使うか、未使用のportを
   2つ指定します。すべてのプロファイルでportの組を重複させないでください。
5. 接続方法を選び、プロファイルを起動します。
6. 接続情報を開き、URL／QR情報をEven appで使用します。
7. 終了時はランチャーからプロファイルを停止します。

tokenはローカルに保存され、設定exportには含まれません。

## 開発と検証

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run license:check
npm run build
npm run smoke       # macOS
npm run package
```

`npm run package`はローカル用のunsigned／ad-hoc署名packageを作成します。
notarize済みmacOS releaseや署名済みWindows installerは作成しません。

## ネットワーク上の注意

Even Terminal 0.8.1は`--tailscale`利用時も`0.0.0.0`で待ち受けます。この
optionは表示するTailscaleアドレスを選ぶもので、待受interfaceをTailscaleだけに
制限するものではありません。接続URLとbridge tokenはcredentialとして扱い、
信頼できるネットワーク経路を使用してください。

## ライセンスとブランド資産

明示的な例外を除き、3mintimerが制作したランチャーのコードとドキュメントは
[MIT License](./LICENSE)で公開しています。

アイコンと画面イメージはこのプロジェクト用に3mintimerが制作したものですが、
Even Realitiesのブランドマークを含んでいます。3mintimerはそのマーク自体の権利を
主張していないため、これらの画像ファイルはMIT Licenseの対象外です。
[ブランド資産の注意事項](./BRAND_ASSETS.md)と
[NOTICE.md](./NOTICE.md)を確認してください。

Even Terminal、Claude Agent SDK、その他の依存関係には、それぞれの利用条件が
適用されます。現在の棚卸し結果は
[Third-party notices](./THIRD_PARTY_NOTICES.md)と
[依存ライセンス台帳](./docs/legal/dependency-license-inventory.md)にあります。
packageを第三者配布する前に、Even Terminalの再配布条件とブランド資産の使用許可を
確認してください。

## ドキュメント

- [現在の引継ぎ情報](./docs/HANDOFF.md)
- [アーキテクチャ](./docs/architecture.md)
- [Even Terminal 0.8.1仕様スナップショット](./docs/upstream/even-terminal-0.8.1-snapshot.md)
- [Windows準備状況](./docs/platform/windows-readiness.md)
- [検証記録](./docs/verification/README.md)
- [公開準備チェックリスト](./docs/releasing.md)
- [セキュリティポリシー](./SECURITY.md)
