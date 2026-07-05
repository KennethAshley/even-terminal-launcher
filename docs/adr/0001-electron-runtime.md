# ADR-0001: ElectronをmacOS v1のデスクトップ基盤にする

- Status: Accepted
- Date: 2026-07-03

## Context

ランチャーはNode.js ESM CLIであるEven Terminalを内包し、複数cwd・port pairで
長時間起動し、stdout/stderr、終了、npm package更新を管理する必要がある。

比較対象はElectronとTauri 2である。

## Decision

macOS v1はElectron、TypeScript、Electron Forgeを採用する。

Even TerminalはElectronのutility processから起動する。rendererにはNode APIを
公開せず、context-isolated preloadのallowlist IPCだけを提供する。

## Reasons

- Even Terminalの公開物はNode.js CLIであり、安定したlibrary exportやstandalone
  binaryではない。
- ElectronはNode runtimeを既に持ち、npm dependencyとutility processの扱いが直接的。
- TauriではNode sidecarとOS/CPU別artifactを別途配布し、runtime更新でもRust/Node
  境界を管理する必要がある。
- 本アプリの主要な難所は画面描画ではなく、Node processとnpm runtime lifecycleである。

## Consequences

- 配布サイズと常駐memoryはTauriより大きい。
- Chromium/Electronのsecurity updateを継続する必要がある。
- Windowsの完全なprocess tree cleanupには、将来Job Objectを使うnative supervisorを
  検討する。
- Even Terminalがstandalone daemonを提供した場合はTauriを再評価する。
