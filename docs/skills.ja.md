# スキル

このパッケージに収録された全 31 スキルのカタログです。各スキルに 1〜2 行の概要を添えています。

各スキルは `kit/skills/backend/<name>/` に、ドメインディレクトリの直下 1 階層で置かれます。そのフォルダ名がスキルの `name:` であり、インストール後のフォルダ名でもあります。したがって下表の **スキル** だけで足ります。`/name` として呼び出す名前、インストール後に `.claude/skills/` に現れる名前、ソースの置き場所が、すべて同じ 1 つの文字列です。先頭 3 文字はドメインを表します。配置と命名の規則は [flatten ビルド規約](https://github.com/openreachtech/hora-skills-ort-renchan/blob/main/.claude/skills/flatten/SKILL.md) を参照してください。各スキルの詳細は、それぞれの `SKILL.md` にあります。

| スキル (= コマンド) | 概要 |
| :-- | :-- |
| `hor-agent-loop` | `@openreachtech/mentsu-agent-loop` の 3 パッケージで LLM エージェントループを構築します。core(反復エンジン)、BullMQ ジョブ実行、GraphQL の起動 mutation と進捗 subscription。 |
| `hor-ai-agent-structure` | `mentsu-agent-loop-core` 上にアプリ側 AI エージェントを構成します。`app/agents/<name>/` に `ProceduralAgentLoop` サブクラスとステップごとの `BaseAgentAction` サブクラスを置きます。 |
| `hor-ai-prompt-document-store` | エージェントの設定・指示文・ドキュメント・ツールスキーマをコードに埋め込まず DB に保持し、リクエスト時にプロンプトへ組み立て、バックアップテーブルでバージョン管理します。 |
| `hor-backend-testing` | テストファイルの配置(DB 書き込みなしは `tests/__tests__`、ありは `tests/_orders`)、DB 書き込みテストの実行順の保証、実行方法、テストとダブルの純粋性ルール。 |
| `hor-bank-id` | 1 つのバックエンドリポジトリ内で、依頼者ごとに排他的で衝突しない行 id プレフィックスを割り当てる。シーダーやテストフィクスチャで 2 人の書き手が同じ明示 id を選ばないようにする。 |
| `hor-build-e2e-test-environment` | `e2e/docker/` 配下の手動操作用ローカル E2E 環境の構築・実行・デバッグ。コンテナ構成、本番にリバースプロキシがある場合はその層、専用シードセット、`up`/`start`/`seed`/`clean`/`down` スクリプト。 |
| `hor-constant-definition` | アプリ定数は必ず 2 ファイルで定義します。`constants/` の CommonJS マスター(単一の情報源)と、それを再 export する `app/constants/` の ESM ブリッジ。 |
| `hor-cookie-authentication` | renchan バックエンドのアクター別 Cookie 認証。認証情報とトークンのモデル、アクセストークンとローテーションするリフレッシュトークン(再利用検知つき)、HttpOnly のリフレッシュ Cookie、signIn / signUp / signOut / renewAccessToken の各リゾルバー。 |
| `hor-database-design` | マイグレーションやモデルを書く前に決めるスキーマの論理設計。正規化の判断、ステータス/カテゴリの表現、カラム型、時刻の保持、読み取りのスケール、履歴とバージョン管理。 |
| `hor-execution-placement-pattern` | 処理(特に書き込み)をどこに実装するかの判断。同期的な GraphQL/REST 操作か、API ハンドラ・post-worker・スケジュールから起動するバックグラウンドワーカーか。 |
| `hor-external-api-client` | `@openreachtech/mentsu-rocket-client` で外部 HTTP/REST API クライアントを実装します。`app/<serviceName>Client/` 配下の Launcher / Payload / Capsule の 3 クラス構成。 |
| `hor-graphql-schema` | renchan サーバの GraphQL SDL(`.graphql`)を書きます。オーディエンス別スキーマ、ドメイン別の番号付きファイル、カスタムスカラー、命名・null 許容・enum・ページネーションの規約。 |
| `hor-graphql-server-engine` | エンドポイントごとの `*GraphqlServerEngine` を実装・起動します。URL、スキーマパス、リゾルバディレクトリ、Share/Context の DI、認証フィルタ、ミドルウェア、スカラー、エラーコード。 |
| `hor-light-rag` | ベクタ DB なしで AI エージェント向けの軽量 RAG を追加します。ローカル埋め込みによる vector-first / LLM フォールバックのランキングと、MySQL の n-gram 全文検索インデックス。 |
| `hor-multi-llm-provider` | Claude / OpenAI / Gemini を 1 つの抽象の下で扱います。抽象モデルプロセッサ、ベンダーごとの基底、モデルごとの具象クラス、モデル名で選択するローダー。 |
| `hor-mutation-resolver` | `BaseMutationResolver` を継承した GraphQL Mutation リゾルバを実装します。状態を変更する操作と、それが動く単一トランザクション。 |
| `hor-post-worker` | post-worker を実装します。リゾルバが解決してレスポンス送信後に発火し、API の本処理に含めない副作用(通知メール、監査ログ、キャッシュ無効化)を実行するフックです。 |
| `hor-query-resolver` | `BaseQueryResolver` を継承した GraphQL Query リゾルバを書きます。ページネーション、関連の include、ドメインエラーの throw、actual と stub のペア。 |
| `hor-renchan-job-bullmq` | `@openreachtech/renchan-job-bullmq` でバックグラウンドジョブを実装・配線します。Manifest / Worker / Dispatcher の 3 点セット、繰り返しジョブ、enqueue、進捗配信、並列数とリトライ。 |
| `hor-resolver-share` | Share クラスを実装します。サーバ起動時に一度作られ `context.share` として全リゾルバに渡されるプロセス単位のシングルトン置き場で、Share と Context の使い分けも扱います。 |
| `hor-resolver-validator` | リゾルバの入力検証クラス(`*InputValidator`)を実装します。`BaseInputValidator` を継承し、値の検査は `mentsu-value-inspector` に委譲します。 |
| `hor-restfulapi-architecture` | renchan バックエンドの REST 層。`server/restfulapi/` 配下のレンダラーアーキテクチャ、ルートとバージョン、`render()`、レスポンス/エラーハッシュ、認証フィルタ、フラッシャー。 |
| `hor-security-audit` | Node プロジェクト全体を読み取り専用でセキュリティ監査し、所見リストを出します。インジェクション、認証漏れ、ポート/データストア露出、シークレット、依存、CORS、レート制限、PII、アップロード。 |
| `hor-sequelize-migration` | renchan/Sequelize のマイグレーションを書きます。`createTable`、`addColumn`/`removeColumn`、`addIndex`、インデックス命名、外部キーカラムを持たせるかの判断。 |
| `hor-sequelize-model` | renchan/Sequelize のモデル定義を書きます。属性、`createOptions`、アソシエーション、スコープ、フック、`MixinModel` の配線。 |
| `hor-sequelize-seeder` | renchan/Sequelize のシーダーを書きます。master / dev-master / development の 3 ディレクトリ分割、ファイル雛形、ファイル名の採番、ファイルごとの ID ブロック採番。 |
| `hor-sequelize-subquery` | `this.addSubquery` で名前付きサブクエリを定義し、`Model.subquery(name, params)` で使います。関連テーブルの条件による絞り込みは JOIN ではなくサブクエリで行います。 |
| `hor-strategy-pattern` | 型文字列で分岐する else-if / switch を、基底プロセッサ・バリアントごとのサブクラス・ディレクトリから自動発見して選ぶ一括ローダーの 3 点構成に置き換えます。 |
| `hor-stub-api` | DB アクセスもビジネスロジックも持たず、スキーマどおりの固定データを返す stub リゾルバを実装します。実装前の API 契約に対してフロントエンドが開発できます。 |
| `hor-subscription-resolver` | GraphQL subscription リゾルバを実装します。操作の宣言、購読者ごとのチャンネルのスコープ、購読可否のゲート、イベントを push する publish 側の配線。 |
| `hor-type-interface` | `.d.ts` で型インターフェースを定義します。`types/models/` のモデルインターフェース(global `model`)と、`types/resolvers/<category>/` のリゾルバ Input/Result 型。 |

