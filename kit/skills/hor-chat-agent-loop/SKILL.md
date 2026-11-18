---
name: hor-chat-agent-loop
description: "How to build a conversational AI agent whose turn the model decides — planner, executor, loop monitor, responder — and where code ends and the prompt begins. Use when adding or changing a chat assistant, its tools, its choice chips or its fixed actions. A fixed step-by-step procedure belongs to the AI agent structure convention; the iteration engine and job/progress plumbing to the agent loop convention."
---

# Chat Agent Loop (a conversation the model plans, turn by turn)

This skill covers **how a chat assistant decides what one turn does** — ask back, answer from a tool,
answer with no tool, or run a fixed action — and how that decision is split between the model and the
code. It is for an assistant the person can ask *anything*: what a turn needs is not known until the
message is read.

Where this skill stops:

- **A procedure whose steps are known in advance** (search records, fill a form) is a fixed
  `ProceduralAgentLoop` with one forced tool call per step. That is `/hor-ai-agent-structure`. Reach
  for this skill only when what is left after fixing the steps is still "it depends on what was
  asked".
- **Running the loop** — the iteration engine, running it as a job, streaming its progress — is
  `/hor-agent-loop`. This skill says what the loop decides, not how it is executed.
- **Calling the model** (providers, request shapes) is `/hor-multi-llm-provider`.

## Grand principle: the model decides what the turn needs, the code decides whether it goes on

- **The model judges.** Whether to ask back, which tools to call, with which arguments, and what the
  answer says are the model's decisions. Code never adds a tool the model did not choose, and never
  rewrites the person's words.
- **The code has the last word on what must hold whatever the model says** — and only on that.
  Every model output is re-validated for shape; cost and time limits (rounds, tool calls, timeouts)
  are enforced; whether the loop retries after an empty round is a code rule. What needs the
  conversation's meaning is never decided in code (next section).
- **One flow for every turn.** A typed message, a choice chip and a follow-up all go through the same
  planner. The only turns that bypass it are fixed actions, which say so with an `actionKey`
  (below) — never by special-casing words.

The failures this prevents:

| Failure | What it did | Rule that prevents it |
| --- | --- | --- |
| A chip glued a request onto the choice ("Not decided yet" → "Show me items about not decided yet") | The conversation's subject was lost; the planner searched for the glued sentence | A reply chip sends its words as they are |
| The search tool ran on every answered turn | "What is my role?" and "Say that in one line" got item cards | The executor runs only what the planner chose; zero calls is valid |
| Tool rules lived in the planner's instruction | Adding a tool meant editing the global prompt; rules for one tool leaked into every turn | Each tool carries its own usage rules |
| "Searching…" was shown before the plan existed | A turn that searched nothing said it was searching | Openers are published only after the plan calls a presenting tool |

## What code decides, what the prompt decides

This is the line every other rule in this skill sits on. Draw it before writing either.

**The test: does deciding it require reading what the conversation means?** If it does, the model
decides it, and the rule is written in the prompt. Code never approximates a meaning with a count,
a length, a keyword or a string match. If it does not — it must hold whatever the model says, or it
is about money, time, permission or shape — code enforces it.

| Code enforces | The prompt decides |
| --- | --- |
| Whose data a tool may read (the engine fixes the person; the model never names one) | Whether to ask back, and how many times for this concern |
| Input validation at the API boundary, including `actionKey` | Whether a message opens a new concern or continues the last one |
| The shape of every model output (JSON, known handling, known tool, argument types, length caps) | What the subject is, and what the standalone query says |
| Cost and time caps: rounds, tool calls per round, timeouts | Which tools to call, or none |
| A safe fallback when the model fails or its reply is unreadable | Whether an answer ends with a question, and which |
| Fixed actions behind an `actionKey` | What to say when nothing was found |
| How many cards are drawn | Which answer options a question back offers |
| How much history is read (a cost cap — set it wide enough for the judgments above) | Tone, length, wording |

**Typical ways code ends up judging meaning**, and where each rule belongs instead:

| Code that judged meaning | What goes wrong | Where it belongs |
| --- | --- | --- |
| "From the person's Nth message on, always answer" | A new concern raised late in the chat gets no clarification: a count of messages stood in for "how often was *this concern* asked about" | The prompt: a few questions per concern, counted by the model from the conversation |
| "A question back is a short line ending in `?`" | A heuristic for the same judgment, one step closer and still wrong | The same prompt rule; delete the heuristic |
| A chip's topic derived from the majority category of the shown results | A follow-up offered on a subject the person never raised | The chip sends plain words; the planner resolves the subject |
| "The previous question" picked by string matching | The chip points at whatever message last failed the match | The chip says "Also show items related to my previous question"; the planner reads the conversation |
| A canned question when nothing was found | The same fixed sentence whatever was asked | The responder says nothing was found and may ask one question of its own |
| The model's answer options discarded when another field was empty | The person loses the choices that answered the question | Keep the model's options; only their format is checked |
| Per-variant behaviour written into the orchestrator | Adding a variant means editing the worker; the worker grows variant-key literals | The tool's own settings (section 2) |
| A history window of a few exchanges | Two questions back and an answer fill it; the earlier concern is out of sight | A wider window; it is a cost cap, so set it for the judgments it serves |

**Signs a rule is on the wrong side:** a constant named `MAX_…_BEFORE_…` that changes what the
assistant says; a regular expression over the person's or the assistant's words; a suffix glued onto
text the model or the person will read; a `variantKey === '…'` outside the tool's settings.

## The four layers

| Layer | Owns | Must not |
| --- | --- | --- |
| **Planner** | One model call per turn: the handling, the tool calls with their arguments, a standalone query, a question back | Write the answer; run anything |
| **Executor** | Running exactly the planned calls, side by side | Add, drop or reword a call |
| **Loop monitor** | Deciding after each round: respond, retry, ask back — from an ordered table of code rules | Call the model |
| **Responder** | Writing the reply from what the tools observed, with or without cards | Decide which tools run |

A turn is: plan → (round → monitor)* → respond, with at most a fixed number of rounds (two is usually
enough: the planner's calls, then one retry the monitor asked for).

## 1. The planner — one structured decision

The planner returns one JSON object (or one forced tool call — see the mapping section). A shape that
holds up:

```json
{
  "handling": "answer | clarify | small_talk | refuse | refer_to_human",
  "acknowledgment": "opening line, only when a presenting tool is called",
  "question": "the one question back, only for clarify",
  "options": ["short answers the person can tap"],
  "reply": "only for small_talk",
  "standaloneQuery": "the request rewritten to stand on its own",
  "toolCalls": [{ "toolName": "...", "arguments": {} }]
}
```

- **`answer` covers answering with tools and without.** A general question, a reply in the
  conversation, or a question about the person's own record is `answer` with no presenting tool —
  often with an empty `toolCalls`.
- **The instruction is about the turn, never about one tool.** It says how to choose a handling, how
  to ask back, how to write the standalone query, and "use the tools as the catalogue's usage rules
  say". A sentence naming a specific tool belongs in that tool's `usageRules` (section 2).
- **The catalogue is built from the registered tools** and appended to the instruction: one line per
  tool, its parameters, and its usage rules underneath. Registering a tool is the only change needed
  for the planner to know it.
- **Code re-validates the plan:**
  - an unknown `handling` becomes `answer`;
  - tool calls are kept only when well-formed and named in the catalogue, and cut to the round's cap;
  - a `clarify` with no question in it becomes `answer` — there is nothing to ask. How many times to
    ask is not checked here;
  - **a reply that cannot be read at all falls back to the turn's default tool** (e.g. the main search
    for `standaloneQuery`). A readable plan with no tool call is the model's choice and is kept —
    the fallback is for "no plan", not for "no tools".
- **Asking back is the planner's call, entirely.** The instruction says when a concern is too vague
  to answer, how many questions a concern gets (counted from the conversation), that a new concern
  starts again from none, and that a reply to an answer's closing question continues the same
  concern. The conversation window must be wide enough for the model to see all of that.

## 2. Tools — each tool owns its rules

A tool is a class over one base. It carries everything about itself, so the planner's instruction
never has to:

| Member | What it is |
| --- | --- |
| `get toolName` | The name the planner writes |
| `get oneLine` | One line for the catalogue |
| `usageRules` | When to call it, when not to, how to fill its arguments — printed under it in the catalogue |
| `answerRules` | Rules added to the responder's instruction only on a turn whose answer used this tool |
| `get producesItems` | Whether it returns things to present (cards). `false` for a tool that only states facts |
| `findArgumentViolation()` | Why the model's arguments cannot run, or `null` |
| `runTool()` | Runs and returns `{ count, titles, factLines, payload }` |

- **A tool that only states facts returns `factLines`** ("The person's role: store manager") and
  `producesItems: false`. The responder states the facts; no card is drawn.
- **Whose data a tool reads is fixed by the engine, never by the model.** A tool about "me" takes no
  person argument at all, and rejects any argument it is given.
- **An argument copied from the person's words is checked against them** where a single changed
  character would change the result (a name, a code), and the call is rejected when it does not
  appear in what the person wrote.
- Settings that cannot live in the tool's class (one generic class serving many data-defined
  variants) live in a code-side hash keyed by the variant key: usage rules, answer rules, how its
  results are shown, what to say when it finds nothing. A fact a variant needs computed (from the
  database) comes from a class looked up by variant key. **The orchestrator holds no variant key
  literal**: adding a variant never edits the worker.

## 3. The executor — only what was planned

- Run the planned calls **concurrently**: they are independent reads the person waits through.
- **Zero calls is a valid round.** It produces no observation, and the monitor sends the turn to the
  responder (section 4, rule 2).
- Each call becomes an **observation**: `{ toolName, status (ok | empty | rejected | error), count,
  producesItems, factLines, resultId, roundNumber }`. Payloads are kept aside under `resultId`, so the
  monitor and the trace see the shape, not the data.
- A failing tool is an `error` observation, never a thrown turn.
- *Optional speed-up:* the default tool may be started on the raw message **before** the planner
  answers and its result reused when the planner's query is the same text (or the message is the
  first of the conversation). It must never be presented unless the plan called that tool.

## 4. The loop monitor — an ordered table of code rules

After each round, the monitor walks a table and the first rule met decides. Each entry is
`{ conditionNumber, isMet: () => boolean, decision }`. A table that holds up:

| # | Condition | Decision |
| --- | --- | --- |
| 1 | The plan asks back | ask back |
| 2 | No tool that presents items was called | respond |
| 3 | A presenting tool found something adoptable | respond |
| 4 | A retry is still allowed (rounds and time left) | retry |
| 5 | Otherwise | respond |

- **Adding a rule is adding a row**, never editing a condition in place (open–closed). The numbers
  are recorded in the trace, so a change of order shows up in the data.
- A retry asks the model once for different calls (a separate small selector), then runs them as
  round two. The monitor itself never calls the model.

## 5. The responder — two paths

| Path | When | Writes | Publishes |
| --- | --- | --- | --- |
| **Result-backed answer** | A presenting tool ran | From the adopted results, with cards | "searching" opener, cards, answer, follow-up chips |
| **Direct reply** | No presenting tool ran | From the conversation and `factLines` | The answer only — no opener, no cards |

- **The system instruction is assembled, not hard-coded:** the assistant's standing character, the
  conversation rules, the glossary, then the `answerRules` of the tools the answer used. The direct
  reply adds a rule that it must not mention items it never looked for.
- **Nothing found is the responder's to say.** It says so plainly and, when it helps, asks one
  question of its own. Code never substitutes a fixed question.
- **Openers depend on the plan.** "Looking for items…" is published only once the plan calls a
  presenting tool.

## Choice chips and fixed actions — the `actionKey`

A chip is either a **reply** or an **action**, and the wire says which:

```graphql
type ChatSuggestion {
  label: String!
  message: String!
  actionKey: String   # null: a reply chip
}

input RequestChatInput {
  # ...
  message: String!
  actionKey: String   # set only when an action chip was pressed
}
```

- **A reply chip sends its words as the person's own reply** — `message` equals `label`, nothing
  added. The planner reads it inside the conversation, so "Not decided yet" after "Which area do you
  want to work on?" stays about that area.
- **An action chip has a fixed meaning** ("What people in the same role are viewing", "Create a
  study plan"). Its `actionKey` names the action, not the implementation; a hash maps it to what runs.
  Pressing it runs that action directly — **no planner call**.
- Validate `actionKey` at the API boundary against the hash (`Object.hasOwn`, so `toString` is not a
  key) and reject unknown keys with an input error.
- **An action that cannot run now** (its variant is inactive, the person cannot be resolved) falls
  back to the planner, which reads the chip's words like any message.
- Do not add an action for something the planner can decide. An action exists because the person
  pressed a button whose meaning must not be reinterpreted.

## Conversation and vocabulary

- The planner and the responder both read a **window of the conversation** (both speakers, oldest
  first) — around a dozen turns is a sensible start. It is a cost cap, so size it for what the model
  must judge from it: two or three questions back plus an answer already take three exchanges. The
  client's limit on what it sends, and the API's limit on what it accepts, are raised with it. Text
  copied into a tool argument comes only from the person's own messages: the assistant's are already
  paraphrased.
- `standaloneQuery` resolves what a follow-up points back to ("And for refunds?" → "How to handle a
  refund request at the counter").
- **A domain glossary** (terms the model would misread: an abbreviation that is a job title in this
  domain, not its common meaning) is one block given to the planner, the retry selector and the
  responder, and used by tools that rank results.

## Trace and regression

- **One trace record per turn**: planned and final handling, standalone query, planned tool names,
  each observation's shape, each monitor decision with its condition number, whether a presenting tool
  ran, prompt section sizes, elapsed time. This is what tuning reads.
- **Unit tests stub the model**; they prove the code obeys a given plan, not that the model plans
  well.
- **A regression script plans fixed conversations against the real model** and judges each plan:
  expected handling, words the standalone query must include or exclude, tools that must or must not
  be called. **Every conversation reported as wrong is added to it** before the fix is merged. It is
  read-only (plans only, runs no tool) and is run wherever the model key lives.

## Mapping onto `mentsu-agent-loop-core`

The four layers fit the `ProceduralAgentLoop` of `/hor-ai-agent-structure` without new machinery:

| Layer | In the loop |
| --- | --- |
| Planner | An action making one forced tool call (`plan_turn`) whose arguments are the plan JSON; re-validated in its `run()` |
| Tools | One `BaseAgentAction` each, registered in `get registry`; `usageRules` and `producesItems` as getters |
| Executor | `advanceState()` performs each planned action by name with `this.performAction(...)` |
| Loop monitor | Plain code in `advanceState()` after the round; its decision goes into the state |
| Round cap | `get maxIterations` |
| Responder | A final action, chosen by whether a presenting tool ran |
| Fixed action | Handled by the generator before the loop starts, like the intent gate there |

Keep everything flowing through `context`, as that skill requires.

## Checklist for a change

- A new tool: its own class, `oneLine`, `usageRules`, `producesItems`; registered; nothing added to
  the planner's instruction.
- A new chip: is its meaning fixed? Then an `actionKey` and an entry in the action hash. Otherwise
  `actionKey: null` and `message` equal to `label`.
- A new monitor rule: a new row, numbered, with a test for met and not met.
- A reported bad conversation: added to the regression script first.
