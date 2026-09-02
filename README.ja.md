# @openreachtech/hora-skills-ort-renchan

*[English](https://github.com/openreachtech/hora-skills-ort-renchan/blob/main/README.md)*

renchan バックエンドスキルを配布するパッケージです。単体でどのリポジトリにも導入でき、Hora Kit ではそのスキルライブラリの 1 つとして装備されます。

## コンセプト

このパッケージが配布するのは **スキルのみ** です。`import` して使うライブラリはなく、同梱する唯一の実行コマンドはそのスキルを配置するためのものです。スキルとは `SKILL.md`(と任意の `references/`・`scripts/`)を収めたディレクトリで、Claude Code が読み込み `/<name>` として呼び出します。導入先のリポジトリにインストールすることで、Open Reach Tech が開発に用いている規約と手順を、そのリポジトリで作業するエージェントに届けます。

配布されるスキルは 31 件、すべて `backend` ドメインのもので、内容は「renchan ベースの Node バックエンド」です。各名前の先頭 3 文字がドメインを表すので、フラットに並んだスキル一覧を見た人が、どれがこのパッケージ由来かを一目で判別できます。ドメインごとに別のパッケージになっており、リポジトリは自分が扱うドメインのものを入れます。

| パッケージ | プレフィックス | ドメイン | スキル数 |
| :-- | :-- | :-- | --: |
| `@openreachtech/hora-skills-ort-core` | `hoc-` | `core` | 39 |
| `@openreachtech/hora-skills-ort-renchan`(このパッケージ) | `hor-` | `backend` | 31 |
| `@openreachtech/hora-skills-ort-furo` | `hof-` | `frontend` | 46 |
| `@openreachtech/hora-skills-ort-support` | `hos-` | `support` | 3 |

[**スキルカタログ**](https://github.com/openreachtech/hora-skills-ort-renchan/blob/main/docs/skills.ja.md) ([English](https://github.com/openreachtech/hora-skills-ort-renchan/blob/main/docs/skills.md)) — このパッケージに収録された全スキルの一覧と概要(1〜2 行)を、呼び出しコマンド名で並べています。

ソースは `kit/skills/backend/<name>/` に配置され、`dist/` が公開されるビルド成果物です。同じスキルフォルダからドメインの階層だけを取り除いた形で、これが Claude Code の求めるフラットな構成です。スキルフォルダ名はそのスキルの `name:` であり、インストール後のフォルダ名でもあります。一貫して同じ 1 つの文字列なので、カタログで見た名前がそのまま入力するコマンドになります。

## インストール

Node.js 20.0.0 以降が必要です(`package.json` の `engines` が宣言している下限)。CI は現行の LTS でビルドしています。

```sh
npm install -D @openreachtech/hora-skills-ort-renchan
```

このパッケージ自身はインストールスクリプトを同梱していません。したがって依存に追加しても、パッケージが入るだけで、何も配置されません。プロジェクト自身の `postinstall` としてコマンドを宣言してください。それだけで、`npm install` がリポジトリにスキルを装備します。

```json
{
  "scripts": {
    "postinstall": "hora-skills-ort-renchan install"
  }
}
```

プロジェクト自身のスクリプトは、npm が v12 以降で差し止める対象の外にあります。したがって、そのプロジェクトをクローンする人に何も要求しません。ここで `npx` は不要です。ライフサイクルスクリプトは `node_modules/.bin` を PATH に入れて実行されるためです。

いま宣言したフックが効くのは、次の `npm install` からです。最初の配置は、コマンドを自分で実行してください。一度だけ配置したい場合や、フックを置けないリポジトリでも同じです。

```sh
npx --no hora-skills-ort-renchan install
```

**`--no` は、ダウンロードの前で npx を止めます** — 名前の解決はレジストリに問い合わせますが、取得はしないので、他人のパッケージの install スクリプトも bin も走りません。これが無いと、bin が入っていない状態は、このパッケージが持たない無スコープ名 `hora-skills-ort-renchan` で公開されたものの取得になります。

パッケージを依存に入れないまま実行する場合 — 一度だけの配置や、フックを置けないリポジトリ — は、名前を省略せずに指定してください。`npx --package=@openreachtech/hora-skills-ort-renchan hora-skills-ort-renchan install` が取得するのは、他人が公開できないスコープ付きの名前です。無スコープの bin 名には、その保証がありませんでした。

## 使い方

スキルは自分のリポジトリの `.claude/skills/` に配置されます。Claude Code はそこからスキルを認識し、それぞれが自身の名前で呼び出せるようになります(`/hor-query-resolver`, `/hor-sequelize-model`, `/hor-post-worker` など)。インストールされたスキルは、そのリポジトリ自身のスキルと 1 つのフラットな一覧に並びます。`hor-` のプレフィックスはそのためにあります。

### 複数のドメインを入れる

4 つのパッケージはいずれも同じ `.claude/skills/` に配置し、それぞれが自分の配置内容を `.hora/<パッケージ名>.json` に記録します。したがって、ある実行が削除するのはそのパッケージが配置したものだけで、他には手を触れません。

```json
{
  "scripts": {
    "postinstall": "hora-skills-ort-renchan install && <別の hora-skills パッケージ> install"
  }
}
```

プレフィックスは 1 つのパッケージだけが持ち、スキルのフォルダ名はパッケージ内で一意なので、配置されたスキルの名前が衝突することはありません。

### リンクではなくディレクトリ

`.claude/` と、その中の `skills/` は、シンボリックリンクではなくリポジトリのディレクトリである必要があります。インストールは対象へ至る各段を検査し、いずれかがリンクであれば、何も書き込まず、何も削除せずに終了します。 インストール内容の記録である `.hora/hora-skills-ort-renchan.json` も同じように検査します。ここにリンクがあると、書き込みがリンク先へ届き、その中身を上書きしてしまうためです。

何も運ばなかったインストールは、その理由を告げ、0 以外の終了コードで終わります。プロジェクト自身の `postinstall` として実行しているなら、それは `npm install` の出力に現れます。単独で実行した場合は `npx --no hora-skills-ort-renchan install` が同じことを告げます。

リンクはコマンドを実行する人の指示ではなく、リポジトリの中身です。それを辿ると、スキルをどこへ書くか、そして前回のスキルをどこから消すかを、リポジトリ側が決められることになります。

いずれかをリポジトリ間で共有するディレクトリへ向けている場合は、そのディレクトリを直接名指ししてください。`npx --no hora-skills-ort-renchan install --dir <解決先のディレクトリ>` で同じ状態に到達し、リンクがある以上、スキルは `.claude/skills/` から見えます。`--dir` はコマンドを実行する人が名指しするものなので、そのまま受け入れます。

### 配置を最新に保つ

配置されたスキルは、リポジトリのソースではなくこのパッケージのビルド成果物です。git 管理からは外します。

```gitignore
.claude/skills/hor-*/
.hora/
```

引数なしの `npm install` はプロジェクトの `postinstall` を再実行するので、スキルも追随します。パッケージをコマンドラインで名指しする更新(`npm install @openreachtech/hora-skills-ort-renchan@latest`)では走りません。フックを置いていないリポジトリも同じです。その場合は、同じコマンドを再実行してください。

```sh
npx --no hora-skills-ort-renchan install
```

`install` は何度実行しても同じ結果になります。前回インストールしたスキル(`.hora/hora-skills-ort-renchan.json` に記録されています)と、このパッケージが配布するスキルと同名のフォルダを削除してから、今回の出力をコピーします。そのため改名されたスキルや削除されたスキルが残らず、`dist/skills/` を手でコピーしていたリポジトリも初回の実行で整理されます。

リポジトリが自分で作ったスキルは、その名前がこのパッケージの配布名と一致しない限り削除されません。`hor-` のプレフィックスを持っているだけで対象になることはなく(`hor-own-skill` は残ります)、配布スキルと完全に同じ名前を付けた場合に限り、その名前はこのパッケージのものとして扱われます。

### コマンド

| コマンド | 動作 |
| :-- | :-- |
| `hora-skills-ort-renchan install` | このパッケージが配布する全スキルを配置し、前回配置したものを置き換える |
| `hora-skills-ort-renchan list` | このパッケージが配布するスキルを表示する(配置はしない) |
| `hora-skills-ort-renchan uninstall` | このパッケージが配置したスキルと、その記録を削除する |
| `hora-skills-ort-renchan help` | 使い方を表示する |

`--dir <path>` で `.claude/skills` 以外のディレクトリに配置できます。

## コントリビューション

バグ報告・機能要望・コード貢献を歓迎します。

GitHub Issues からお気軽にご連絡ください。

```sh
git clone https://github.com/openreachtech/hora-skills-ort-renchan.git
cd hora-skills-ort-renchan
npm install
npm run lint
npm test
```

## ライセンス

本プロジェクトは Apache License 2.0 で公開されています。

詳細は [LICENSE ファイル](./LICENSE) を参照してください。

## 開発者

[Open Reach Tech Inc.](https://openreach.tech)

## 著作権

© 2026 Open Reach Tech Inc.
