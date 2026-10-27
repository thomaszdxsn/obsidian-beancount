# Plan 007: 把 Fava 进程生命周期收进 `FavaProcess`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. `plans/README.md` 的 Status 由编排者维护；执行者
> **不要**改该索引。
>
> **Drift check (run first)**: `git diff --stat 8b75729..HEAD -- apps/obsidian-plugin/fava.ts apps/obsidian-plugin/main.ts apps/obsidian-plugin/tests/fava.test.ts apps/obsidian-plugin/tests/issue-29.test.ts apps/obsidian-plugin/tests/plugin-lifecycle.test.ts CHANGELOG.md`
> 本计划写于 `8b75729`。
> **API 依赖**：002（#68）的 `apps/obsidian-plugin/vault-path.ts` 必须导出 `resolveInVault(root, vaultRel): { ok: true; absPath: string } | { ok: false; reason: 'escape' }` 与 `vaultRoot`。`clock.ts` / `FakeClock` 由 002 引入，Fava **不得** import。
> **串行顺序**：执行时 001–006 已合并。`main.ts` 因 #69/#68/#73 变瘦是预期漂移，**不要**因此 STOP。对照下方 **Fava 生命周期**摘录（`favaChild` / `launchFava` / `startFavaProcess`）：这些还在，就按本计划搬迁。若 Fava 生命周期已经不在 `main.ts`、或 `resolveInVault` 不存在，当作 STOP。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: **API** — 只依赖 `plans/002-ledger-validation.md` 的 `vault-path.ts`（`resolveInVault` / `vaultRoot`）。**串行** — 排在 006 之后以免并行改 `main.ts`；001、003–006 的 API 本计划不消费
- **Category**: tech-debt
- **Planned at**: commit `8b75729`, 2026-10-28
- **Issue**: https://github.com/thomaszdxsn/obsidian-beancount/issues/74

## Why this matters

`fava.ts` 已经有 Runner / Opener / Probe 和 `waitForFavaReady`（#76 把 HTTP 就绪判断钉死了），但单实例锁、绑定端口、选 Ledger file、kill、意外退出 notice 仍挂在 `BeancountPlugin` 上（约 90 行 + 十几个字段）。`fava.test.ts` 与 `issue-29.test.ts` 为此各写一份 `loadPlugin()`，启动整个插件才能测 Fava。把生命周期收进 `FavaProcess` 之后，插件只接线（Start / Stop / onload / unload），测试打 module 的 seam，不再为子进程去 boot 插件。

这是内部重构。用户可见的 Start/Stop/静默启动/端口复用/HTTP 就绪 **保持 #76 已定行为**，禁止重开。

## Current state

相关文件（行号相对 `8b75729`；001–006 合并后 `main.ts` 行号会漂，用符号搜）：

- `apps/obsidian-plugin/fava.ts` — 常量、`isFavaBinary`、`normalizeFavaPort`、`favaUrl`、`runFavaProcess`、`openFavaUrl`、`probeFavaUrl`、`captureFavaStderr`、`waitForFavaReady`、`waitForChildClose`。**没有**进程状态机。
- `apps/obsidian-plugin/main.ts` — `BeancountPlugin` 持有全部 Fava 字段与 `launchFava` / `startFavaProcess` / `stopFava` / unload kill。
- `apps/obsidian-plugin/tests/fava.test.ts` — 纯函数单测 + `describe('Start Fava / Stop Fava')` 整插件启动。
- `apps/obsidian-plugin/tests/issue-29.test.ts` — 另一份 `loadPlugin`，测 Start / 非法二进制 / onload / 缺账本 / 库外路径。
- `apps/obsidian-plugin/tests/plugin-lifecycle.test.ts` — `describe('fava start without a process')` 仍写 `plugin.favaRunner`（cutover 后会编不过，必须下沉或删）。
- `apps/obsidian-plugin/vault-path.ts` — **由 002（#68）引入**。本计划的 `resolveLedger` 适配器必须调用它的 `resolveInVault`，禁止再写第三份 `relative(root, …)`（grill 风险 7、A6.5）。
- `apps/obsidian-plugin/clock.ts` — **由 002（#68）引入**。Fava **不得**改用 `Clock`（A6.4 / A5.5）：就绪轮询继续走 `delay: (ms) => Promise<void>`。
- `apps/obsidian-plugin/tests/fakes.ts` — 002 引入 `FakeClock`。Fava 测试继续 `delay: async () => {}`，禁止 `vi.useFakeTimers`，禁止 `FakeClock`。

`BeancountPlugin` 上 **今天** 的 Fava 清单（cutover 后必须全部离开插件，或收成一个 `FavaProcess` 实例）：

| 成员 | 行（`8b75729`） | 去向 |
| --- | --- | --- |
| `favaRunner` | `main.ts:475` | `FavaPorts.runner` |
| `favaOpener` | `main.ts:477` | `FavaPorts.opener` |
| `favaReadyProbe` | `main.ts:479` | `FavaPorts.probe` |
| `favaReadyTimeoutMs` | `main.ts:481` | `FavaProcess` 构造 `timeouts.readyMs` |
| `favaDelay` | `main.ts:483-484` | `FavaPorts.delay` |
| `favaCloseTimeoutMs` | `main.ts:486` | `FavaProcess` 构造 `timeouts.closeMs` |
| `favaChild` | `main.ts:488` | `FavaProcess` 私有 |
| `favaBoundPort` | `main.ts:490` | `FavaProcess` 私有 |
| `favaServing` | `main.ts:492` | `FavaProcess` 私有 |
| `favaExpectExit` | `main.ts:494` | `FavaProcess` 私有 |
| `favaStderr` | `main.ts:496` | `FavaProcess` 私有 |
| `favaStart` | `main.ts:498` | `FavaProcess` 私有 in-flight Promise |
| `isFavaRunning` / `clearFavaChild` / `revealFava` / `stopFava` / `launchFava` / `waitUntilFavaServes` / `startFavaProcess` | `main.ts:739-875` | `FavaProcess` 方法 |
| Start/Stop 命令 | `main.ts:643-654` | 薄回调 → `fava.start` / `fava.stop` |
| unload cleanup | `main.ts:676-678` | `fava.dispose()` |
| `runFavaOnActivate` | `main.ts:680-681` | `fava.start({ announce: false, …快照 })` |
| `MISSING_FAVA_NOTICE` / `NO_LEDGER_FAVA_NOTICE` | `main.ts:138-141` | 迁到 `fava.ts`（文案一字不改） |
| `ChildProcess` import | `main.ts:5` | 若插件不再持有 child，删掉 |

摘录（确认你看着同一份代码）：

```ts
// apps/obsidian-plugin/main.ts:474-498
/** How Fava is started; tests swap in their own runner. */
favaRunner: FavaRunner = runFavaProcess;
/** Opens the Fava UI after start or reuse; tests swap this. */
favaOpener: FavaOpener = openFavaUrl;
/** HTTP GET of Fava's root; tests swap this so they never open sockets. */
favaReadyProbe: FavaReadyProbe = probeFavaUrl;
/** Bound on waiting for Fava to answer; tests shrink this. */
favaReadyTimeoutMs = FAVA_READY_TIMEOUT_MS;
/** Pause between readiness probes and bound on the close wait; tests no-op this. */
favaDelay: (ms: number) => Promise<void> = (ms) =>
	new Promise((resolve) => window.setTimeout(resolve, ms));
/** Bound on waiting for stdio close after Fava exits; tests shrink this. */
favaCloseTimeoutMs = FAVA_CLOSE_TIMEOUT_MS;
/** Live Fava child, killed when the plugin unloads. */
private favaChild: ChildProcess | null = null;
/** Port the live child was started with; reuse must open this URL. */
private favaBoundPort: number | null = null;
/** True once the live child answered HTTP with status < 400. */
private favaServing = false;
/** True when Stop Fava or unload is the reason the child will exit. */
private favaExpectExit = false;
/** Stderr tail of the live child; captured once at spawn. */
private favaStderr: () => string = () => '';
/** In-flight start so a second command cannot spawn another process. */
private favaStart: Promise<boolean> | null = null;
```

```ts
// apps/obsidian-plugin/main.ts:822-842
private async startFavaProcess(): Promise<boolean> {
	const command = this.settings.favaPath.trim() || 'fava';
	if (!isFavaBinary(command)) {
		new Notice(MISSING_FAVA_NOTICE);
		return false;
	}
	const requested = this.settings.entryLedger.trim() || this.app.workspace.getActiveFile()?.path || '';
	if (!requested.endsWith('.bean') && !requested.endsWith('.beancount')) {
		new Notice(NO_LEDGER_FAVA_NOTICE);
		return false;
	}
	const adapter = this.app.vault.adapter as FileSystemAdapter;
	const root = vaultRoot(adapter.getBasePath());
	const confined = resolve(root, requested);
	const rel = relative(root, confined);
	if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
		new Notice(`Fava: entry ledger must be a vault file, not "${clipText(requested)}"`);
		return false;
	}
	const port = normalizeFavaPort(this.settings.favaPort);
	const result = await this.favaRunner(command, ['-H', FAVA_HOST, '-p', String(port), confined]);
```

```150:190:apps/obsidian-plugin/fava.ts
export async function waitForFavaReady(
	child: ChildProcess,
	url: string,
	probe: FavaReadyProbe,
	options: {
		timeoutMs?: number;
		intervalMs?: number;
		delay?: (ms: number) => Promise<void>;
		now?: () => number;
		closeTimeoutMs?: number;
	} = {}
): Promise<FavaReadyOutcome> {
	const timeoutMs = options.timeoutMs ?? FAVA_READY_TIMEOUT_MS;
	const intervalMs = options.intervalMs ?? FAVA_PROBE_INTERVAL_MS;
	const delay = options.delay ?? defaultDelay;
	const now = options.now ?? Date.now;
	const started = now();
	let exited = child.exitCode !== null;
	let closed = false;
	const onExit = () => {
		exited = true;
	};
	const onClose = () => {
		closed = true;
	};
	child.once('exit', onExit);
	child.once('close', onClose);
	const finishExit = async (): Promise<'exited'> => {
		await waitForChildClose(child, {
			alreadyClosed: closed,
			timeoutMs: options.closeTimeoutMs ?? FAVA_CLOSE_TIMEOUT_MS,
			delay,
		});
		return 'exited';
	};
	try {
		while (true) {
			if (exited || child.exitCode !== null) return await finishExit();
			const status = await probe(url);
			if (exited || child.exitCode !== null) return await finishExit();
			if (status != null && status < 400) return 'ready';
			if (now() - started >= timeoutMs) return 'timeout';
			await delay(intervalMs);
		}
```

约定：

- 插件目录是扁平的 `apps/obsidian-plugin/*.ts`。领域文件名 = 产品功能（已有 `fava.ts`），**不要**新建 `fava-process.ts`。
- 错误/提示走 `Notice` 字符串；本计划把 `new Notice` 换成 `ports.notify`，文案保持现状。
- 测试风格：vitest + `FakeVault`（`tests/fakes.ts`）。Fava 子进程用假 `ChildProcess`（见 `fava.test.ts` 的 `liveChild`），Runner/Probe/Delay 全部注入。
- 覆盖率地板 90%（`apps/obsidian-plugin/vitest.config.mts` 的 `thresholds`）。
- TDD：red → green，竖切。禁止 `vi.useFakeTimers`。

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Lint | 仓库根 `pnpm lint` | exit 0 |
| Build | 仓库根 `pnpm build` | exit 0 |
| 全量测试 | 仓库根 `pnpm test` | exit 0；基线约 1064 测试全绿（001–006 之后数量会变，以全绿 + 覆盖率 ≥90% 为准） |
| 单文件 | `cd apps/obsidian-plugin && npx vitest run tests/fava.test.ts` | 该文件全绿 |
| 单文件 | `cd apps/obsidian-plugin && npx vitest run tests/issue-29.test.ts` | 该文件全绿 |
| 类型检查 | `cd apps/obsidian-plugin && npx tsc -noEmit -skipLibCheck` | exit 0 |
| Bench | **本计划不跑**。不要 `pnpm --filter beancount-obsidian bench`，不要 `BENCH_UPDATE=1`。 |

## Suggested executor toolkit

- 若环境有 `tdd` skill：本计划的 Step 1–3 按 red→green 执行（先写 `FavaProcess` 测试，再搬实现）。
- 参考：`apps/obsidian-plugin/tests/fava.test.ts` 现有 `liveChild` / `fakeChild` / `writeChildStderr`；假端口模式对齐 `waitForFavaReady` 单测（已注入 `delay`）。
- 领域词用根 `CONTEXT.md`：Ledger file、Entry ledger。实现词 **Fava process** / seam **不要**写进 CONTEXT.md（grill Round 6）。

## Scope

**In scope**（只改这些）：

- `apps/obsidian-plugin/fava.ts` — 增加 `FavaPorts`、`FavaProcess`、`resolveFavaLedger`（或同等名字的纯适配器）；迁入 notice 常量；保留现有纯函数。
- `apps/obsidian-plugin/main.ts` — 删除上表进程状态；构造 `FavaProcess`；命令 / onload / cleanup 接线；生产 `resolveLedger` 调用 `resolveInVault`。
- `apps/obsidian-plugin/tests/fava.test.ts` — BDD 下沉到 `FavaProcess`；`loadPlugin` 最多留 1 个插件冒烟。
- `apps/obsidian-plugin/tests/issue-29.test.ts` — 同上；`mergeSettings` / `isFavaBinary` 单测可留（它们不启动插件）。
- `apps/obsidian-plugin/tests/plugin-lifecycle.test.ts` — 删除或下沉 `describe('fava start without a process')`（否则仍写 `plugin.favaRunner`）。
- 根 `CHANGELOG.md` — `## Unreleased` 下 **一行** Internal（见下文）。不改 README。

**Out of scope**（看起来相关也别动）：

- `waitForFavaReady` 的就绪规则（状态码 `< 400` 才算就绪；AirPlay 403 不算；30s 超时进程保留；提前退出引用 stderr 最后一行）。这是 #76 / PR #76 已定，禁止重开。
- `clock.ts` / `FakeClock` / 校验 debounce。Fava 不用 Clock。
- `vault-path.ts` 的实现（只 **调用** `resolveInVault`）。不要为 Fava 再写一份 `relative(root, resolve(root, path))`。
- 对笔记 fence 启动 Fava、运行中改端口自动重启：#75.10 已定为「不启动 / 提示先 Stop」，不是本计划的产品问题。
- `plugin.test.ts` 里 Fava **设置项** UI（`Fava executable` / `Fava port`）——那是 settings，不是进程生命周期。
- parser、align/format/suggest、bench expected、CONTEXT.md 术语、ADR。
- 不要统一四份 `loadPlugin`（A1.6）。

## Git workflow

- Branch: `refactor/74-fava-process`，基于 **最新 main**（001–006 已合入的那个 tip），不要从 `8b75729` 直接开。
- 按逻辑单元提交；中文 conventional commits。例：
  - `test: 在 FavaProcess 上锁定 Start/Stop 生命周期（#74）`
  - `refactor: Fava 进程生命周期移进 FavaProcess（#74）`
- 不要 push、不要开 PR（编排者负责）。

## 模块边界（A5.4，经 A6.5 修正）

签名以实现时微调命名为准，但不得：订阅 settings、自动因端口变化重启、让 `fava.ts` import `validation.ts`、把 Fava 就绪改成 `Clock`。

```ts
export interface FavaPorts {
	runner: FavaRunner;
	opener: FavaOpener;
	probe: FavaReadyProbe;
	delay: (ms: number) => Promise<void>;
	notify: (text: string) => void;
	resolveLedger: (
		entryLedger: string,
		activePath: string | null,
	) => { ok: true; absPath: string } | { ok: false; reason: 'no-ledger' | 'escape' };
}

export class FavaProcess {
	constructor(ports: FavaPorts, timeouts?: { readyMs: number; closeMs: number })
	start(req: {
		announce: boolean;
		command: string;
		port: number;
		entryLedger: string;
		activePath: string | null;
	}): Promise<void>
	stop(): void
	dispose(): void // unload：kill，且不再 notice「Fava stopped.」
}
```

`start(req)` **每次吃当前 settings 快照**（`command` = `favaPath.trim() || 'fava'`，`port` = 设置里的 `favaPort`，`entryLedger` / `activePath` 同上）。`FavaProcess` 不持有 settings 引用、不 watch 端口（A5.4 否决 B；#75.10 = 运行中改端口提示先 Stop）。

行为必须从 `main.ts:739-875` 原样搬迁，包括：

1. `isFavaBinary(command)` 失败 → `notify(MISSING_FAVA_NOTICE)`，不 spawn、不 open。
2. `resolveLedger(entryLedger, activePath)`：`no-ledger` → `NO_LEDGER_FAVA_NOTICE`；`escape` → `` Fava: entry ledger must be a vault file, not "${clipText(requested)}" ``（`clipText` 已从 `bean-check.ts` 导出，可继续用）。
3. spawn 参数：`[ '-H', FAVA_HOST, '-p', String(normalizeFavaPort(req.port)), absPath ]`。非法端口回落 5000（已有 `normalizeFavaPort`）。
4. `runner` 返回 `missing` → 同样 `MISSING_FAVA_NOTICE`。返回无 `child` → 不 latch 为 running（见 `plugin-lifecycle.test.ts:339-364`：随后 Start 会再 spawn，Stop 提示 `Fava is not running.`）。
5. HTTP 就绪：复用 `waitForFavaReady`；`announce === true` 且 ready 才 `opener(url)` + `Fava is running at ${url}`。`announce === false`（`runFavaOnActivate`）spawn 但不打开、不弹 running。失败仍 `notify`（静默启动失败也要报，见现 `fava.test.ts:645-660`）。
6. 复用存活且已 serving 的进程：不重新 spawn；打开 **绑定端口** 的 URL。若 `normalizeFavaPort(req.port) !== bound`，notice 为 `Fava is already running on port ${bound}; stop it and start again to use port ${wanted}.`，不再说 running。
7. 并发 `start`：共用同一个 in-flight Promise；只 spawn 一次；两次 `announce: true` 都 open。
8. 进程已在跑但尚未 serving：join 正在进行的 `waitForFavaReady`，不要第二次 probe 循环（现 `fava.test.ts:375-419`）。
9. `stop()`：在跑 → kill + `Fava stopped.`；没在跑 → `Fava is not running.`。Stop/dispose 期间不要再弹 timeout / exited。
10. `dispose()`：kill 且 **不** notice `Fava stopped.`（现 unload：`fava.test.ts:540-551`）。
11. 子进程自己退出后可以再 `start` 并重新 spawn。serving 之后意外退出 → `Fava exited: ${favaExitReason(...)}`。
12. 30s（或注入的 `readyMs`）不应答：`Fava did not answer at ${url}`，**进程保留**（Stop 仍能杀掉）。

### `resolveLedger` 适配器（风险 7 / A6.5）

纯函数，建议放在 `fava.ts`，**先**判 Ledger file 扩展名（产品：不对笔记 fence 启 Fava），**再**调用 `resolveInVault`：

```ts
import { resolveInVault } from './vault-path';

export function resolveFavaLedger(
	root: string,
	entryLedger: string,
	activePath: string | null,
): { ok: true; absPath: string } | { ok: false; reason: 'no-ledger' | 'escape' } {
	const requested = entryLedger.trim() || activePath || '';
	if (!requested.endsWith('.bean') && !requested.endsWith('.beancount')) {
		return { ok: false, reason: 'no-ledger' };
	}
	const resolved = resolveInVault(root, requested);
	if (!resolved.ok) return { ok: false, reason: 'escape' };
	return { ok: true, absPath: resolved.absPath };
}
```

`resolveInVault` **只认 002 合同**：`resolveInVault(root, vaultRel): { ok: true; absPath: string } | { ok: false; reason: 'escape' }`（两参数，在 `vault-path.ts`；不是 `VaultPort` 的单参数形式）。**不要**接受 `{ escape }` 无 `ok` 的变体，也不要在 `fava.ts` / `main.ts` 再写 `relative(root, resolve(root, path))`。生产 `root` 来自同文件的 `vaultRoot(adapter.getBasePath())`。不要复制 `realpathSync`。

插件适配器把 `resolveFavaLedger(root, …)` 填进 `FavaPorts.resolveLedger`。单测直接喂假 `resolveLedger`，不碰 `realpath`。

### 插件接线（A5.4）

`BeancountPlugin` 只保留 **一个** `fava: FavaProcess`（onload 里用生产 ports 构造）。允许测试在 `onload` 之前赋一个已注入假 ports 的实例（`plugin.fava ??= …` 或 `plugin.fava = plugin.fava ?? new FavaProcess(...)`）。**禁止**再暴露 `favaRunner` / `favaChild` / `favaStart` 等。

```ts
// onload 伪代码
this.fava ??= new FavaProcess(
	{
		runner: runFavaProcess,
		opener: openFavaUrl,
		probe: probeFavaUrl,
		delay: (ms) => new Promise((r) => window.setTimeout(r, ms)),
		notify: (text) => new Notice(text),
		resolveLedger: (entryLedger, activePath) =>
			resolveFavaLedger(vaultRoot(this.app.vault.adapter.getBasePath()), entryLedger, activePath),
	},
	{ readyMs: FAVA_READY_TIMEOUT_MS, closeMs: FAVA_CLOSE_TIMEOUT_MS },
);
this.addCommand({
	id: 'start-fava',
	name: 'Start Fava',
	callback: () =>
		void this.fava.start({
			announce: true,
			command: this.settings.favaPath.trim() || 'fava',
			port: this.settings.favaPort,
			entryLedger: this.settings.entryLedger,
			activePath: this.app.workspace.getActiveFile()?.path ?? null,
		}),
});
this.addCommand({
	id: 'stop-fava',
	name: 'Stop Fava',
	callback: () => this.fava.stop(),
});
this.register(() => this.fava.dispose());
if (this.settings.runFavaOnActivate) {
	this.app.workspace.onLayoutReady(() =>
		void this.fava.start({
			announce: false,
			command: this.settings.favaPath.trim() || 'fava',
			port: this.settings.favaPort,
			entryLedger: this.settings.entryLedger,
			activePath: this.app.workspace.getActiveFile()?.path ?? null,
		}),
	);
}
```

## Steps

### Step 1: 列出 seam，TDD `FavaProcess`（red）

要测的 seam（先写测试，实现还没有时失败）：

1. `FavaPorts` 六口：`runner` / `opener` / `probe` / `delay` / `notify` / `resolveLedger`
2. `FavaProcess.start(req 快照)` / `stop` / `dispose`
3. `resolveFavaLedger` × `resolveInVault`（可用固定假 `resolveInVault`，或对真实 `vault-path.ts` 做「`../outside.bean` → escape」）

在 `tests/fava.test.ts` 增加 `describe('FavaProcess', …)`，**不要** `new BeancountPlugin`。把 `liveChild` / `fakeChild` / `writeChildStderr` 留在本文件复用。`delay: async () => {}`；`readyMs`/`closeMs` 测超时与 close 时用 `0`。

把下方「Test plan」里每一条 BDD 写成对 `FavaProcess` 的测试（含缺失的 `.beancount` 当前文件）。此步结束时这些新测试是红的。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/fava.test.ts` → `FavaProcess` 描述块失败（找不到导出或行为未实现）；原有 `isFavaBinary` / `waitForFavaReady` / `runFavaProcess` 描述块仍绿。

### Step 2: 实现 `FavaProcess` + `resolveFavaLedger`（green）

把 `main.ts:739-875` 的状态机搬进 `fava.ts`。`waitForFavaReady` / `captureFavaStderr` / `waitForChildClose` / `normalizeFavaPort` / `favaUrl` / `isFavaBinary` **原样调用**，不要重写就绪循环。

notice 常量移到 `fava.ts` 并导出（或模块内私有 + 测试断言完整字符串）。`main.ts` 的 Fava 路径删掉 `new Notice`。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/fava.test.ts` → `FavaProcess` 新测试绿。此时旧的 `describe('Start Fava / Stop Fava')` 可能仍绿（还在打插件）。

### Step 3: 插件 cutover

`main.ts`：按上面伪代码接线；删除 Fava 字段与私有方法；删除仅被 Fava 使用的 `ChildProcess` import 与 `runFavaProcess` 等（插件仍需 `FavaProcess`、`runFavaProcess`、`openFavaUrl`、`probeFavaUrl`、`resolveFavaLedger`、`vaultRoot`）。

把 `tests/fava.test.ts` 的 `describe('Start Fava / Stop Fava')` **整段改写**为 Step 1 的 `FavaProcess` 测试（若 Step 1 已覆盖则删除重复）。`loadPlugin` 只留给 **≤1** 个插件冒烟：例如「`start-fava` / `stop-fava` 命令存在，且 `runFavaOnActivate` 时 `onload` 会 `start({ announce: false })`」（可在 `onload` 前注入 `plugin.fava = new FavaProcess(假 ports)`）。

`tests/issue-29.test.ts`：Fava 命令用例改为 `FavaProcess`（或从 `fava.test.ts` 覆盖后删除重复）。`mergeSettings` / `isFavaBinary` 保持纯单测。`loadPlugin` **最多 1** 个插件冒烟；若 `fava.test.ts` 已冒烟 onload，本文件可以 **0** 个 `BeancountPlugin` Fava 用例。

`tests/plugin-lifecycle.test.ts`：把 `fava start without a process` 迁到 `FavaProcess` 测试后删除该 `describe`。

全仓库搜 `favaRunner` / `favaOpener` / `favaReadyProbe` / `favaDelay` / `favaChild` / `launchFava`，测试里不得再对 `BeancountPlugin` 赋这些字段。

**Verify**:

```sh
cd apps/obsidian-plugin && npx vitest run tests/fava.test.ts tests/issue-29.test.ts tests/plugin-lifecycle.test.ts
```

全绿。并且：

```sh
grep -n 'loadPlugin' apps/obsidian-plugin/tests/fava.test.ts
```

Fava 生命周期描述块不再调用 `loadPlugin`（冒烟那 1 个除外）。

```sh
grep -nE 'favaChild|favaBoundPort|favaStart|favaRunner|launchFava|startFavaProcess' apps/obsidian-plugin/main.ts
```

无匹配。

### Step 4: CHANGELOG；不改 README；不跑 bench

根 `CHANGELOG.md` 的 `## Unreleased` 增加 Internal 一行，例如：

```markdown
### Internal

- Start/Stop Fava 的子进程生命周期收进 `FavaProcess`（#74）。
```

若 `## Unreleased` 还没有 `### Internal`，加上。不要改 README（命令/设置/可见行为不变）。不要碰 `bench/expected.json`。

**Verify**: `git diff README.md` 为空。`git diff CHANGELOG.md` 只有 Internal 一行（外加必要标题）。

### Step 5: 全量门禁

**Verify**: 仓库根 `pnpm lint`、`pnpm build`、`pnpm test` 均为 exit 0。覆盖率 statements/branches/functions/lines ≥ 90。

## Test plan

结构模式：`tests/fava.test.ts` 里已有的 `liveChild` + 注入 `favaRunner`/`favaReadyProbe`/`favaDelay`；改成注入 `FavaPorts`。不要 `vi.useFakeTimers`，不要 `FakeClock`（A6.4）。

BDD 地图（issue #74；`# 待产品决定` 且 #76 已定的改为硬验收）：

| BDD 场景 | issue 标注 | 本计划 | 写在 |
| --- | --- | --- | --- |
| 有 Entry ledger 时对它启动（`fava -H 127.0.0.1 -p 5000 /vault/main.bean`，打开并提示 running） | 现有 issue-29 | 硬验收 | `FavaProcess.start` |
| 没有 Entry ledger 时对当前打开的 Ledger file 启动（`ledger.bean` **和** `books.beancount`） | 现有 + **缺失** `.beancount` | 硬验收；补 `.beancount` | `FavaProcess`；`resolveLedger` 返回该 absPath |
| 库外 Entry ledger 或没有可用账本 → 不启动，提示 `No valid bean file` **现行文案** `Set Entry ledger in the Beancount settings or open a .bean / .beancount file.` | 现有 | 硬验收（#75.10 文案已定，不要改回 issue 草稿里的短句） | `reason: 'no-ledger' \| 'escape'` |
| 可执行文件不是 fava（`/bin/bash`）或 spawn missing → 不启动不打开，提示含 `fava not found` 与 `pip install fava` | 现有 | 硬验收 | `isFavaBinary` + `runner.missing` |
| 并发两次 Start 只 spawn 一次，两次都打开 URL | 现有 fava.test | 硬验收 | in-flight Promise |
| 重复 Start 复用存活进程并打开**绑定**端口；设置改成 8080 也不重新 spawn，提示 already running on port 5000 | issue 写「待产品决定」 | **硬验收**（#76 / #75.10 已定：不自动重启） | reuse + bound port |
| 子进程自行退出后再 Start 会重新 spawn | 现有 | 硬验收 | |
| 子进程启动后立刻退出：不提示 running、不打开 UI，提示 `Fava exited:` + stderr 第一有意义行 | issue 写「缺失 / 待产品决定 #75.2」 | **硬验收**（#76 已实现；现 `fava.test.ts:553-576`） | |
| Stop：在跑 → kill + `Fava stopped.`，之后 Start 再 spawn；没在跑 → `Fava is not running.` | 现有 | 硬验收 | |
| `runFavaOnActivate`：spawn，不打开浏览器，不弹 running | 现有 | 硬验收：`start({ announce: false })`；**外加** ≤1 插件冒烟证明 onload 调用了它 | |
| 插件卸载 kill 子进程、不弹 stopped | 现有 | 硬验收：`dispose()`；冒烟可选 | |
| 非法端口 0 / 65536 / 非整数 → `-p 5000` 且打开 `http://127.0.0.1:5000/` | 现有 `normalizeFavaPort` | 硬验收 | 保留纯函数测 + `start` 走 normalize |
| 没有 Entry ledger 且当前是带 fence 的笔记 → **不对笔记启动** | issue 写「待产品决定 #75.10」 | **硬验收现行行为**（#76）：`NO_LEDGER_FAVA_NOTICE`，不 spawn | 现 `fava.test.ts:663-674` 下沉 |

必须一并下沉、issue BDD 没列但生产已有的 characterization：

- 配置了 `favaPath` / `favaPort` 时 args 与 URL 用它们（`fava.test.ts:314-331`）
- join in-flight wait，probe 次数为 1（`:375-419`）
- Stop/unload 后不要 timeout notice（`:422-463`）
- exit 与 close 之间的 stderr 进入 `Fava exited:`（`:465-484`）
- probe 成功之前不 open（`:578-600`）
- timeout 保留进程，Stop 仍能杀（`:602-617`）
- serving 后意外退出 notice `Fava exited: 1`（`:619-633`）
- Stop 杀进程不额外 `Fava exited`（`:635-643`）
- 静默启动失败仍 `Fava exited: …` 且不 open（`:645-660`）
- runner 成功但无 `child`：不 open；再次 Start 再 spawn；Stop → `Fava is not running.`（`plugin-lifecycle.test.ts:339-364`）

插件冒烟上限：`fava.test.ts` ≤1，`issue-29.test.ts` ≤1。冒烟只证明命令注册 / onload 接线，不在插件级重复生命周期矩阵。

**Verify**: `cd apps/obsidian-plugin && npx vitest run tests/fava.test.ts tests/issue-29.test.ts` → 全绿，含 `.beancount` 新用例。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm lint`、`pnpm build`、`pnpm test` 在仓库根 exit 0
- [ ] 覆盖率地板仍 ≥90%（vitest thresholds）
- [ ] `grep -nE 'favaChild|favaBoundPort|favaStart' apps/obsidian-plugin/main.ts` 无匹配
- [ ] `grep -nE 'favaRunner|favaOpener|favaReadyProbe|favaDelay|favaReadyTimeoutMs|favaCloseTimeoutMs|favaServing|favaExpectExit|launchFava|startFavaProcess|waitUntilFavaServes' apps/obsidian-plugin/main.ts` 无匹配
- [ ] `grep -n 'new FavaProcess\\|class FavaProcess' apps/obsidian-plugin/fava.ts` 有 `class FavaProcess`
- [ ] `grep -n 'resolveInVault' apps/obsidian-plugin/fava.ts apps/obsidian-plugin/main.ts` 至少一处（生产 `resolveLedger` 适配器）
- [ ] `grep -nE 'relative\(root,' apps/obsidian-plugin/fava.ts` 无匹配（禁止第三份禁逃逸）
- [ ] `grep -n 'from \'./clock\'\\|from \"./clock\"' apps/obsidian-plugin/fava.ts` 无匹配（Fava 不用 Clock）
- [ ] `grep -n 'vi.useFakeTimers' apps/obsidian-plugin/tests/fava.test.ts apps/obsidian-plugin/tests/issue-29.test.ts` 无匹配
- [ ] `grep -n 'BeancountPlugin' apps/obsidian-plugin/tests/fava.test.ts` 至多出现在 1 个冒烟用例（及文件顶 import）；`describe('FavaProcess'` 或同等块内不得 `loadPlugin` / `new BeancountPlugin`
- [ ] `grep -n 'BeancountPlugin' apps/obsidian-plugin/tests/issue-29.test.ts` 同上限；Fava 生命周期断言不经过 `loadPlugin`
- [ ] `grep -n 'favaRunner' apps/obsidian-plugin/tests` 无匹配（或仅出现在注释以外的 `FavaPorts.runner` 局部变量，不得 `plugin.favaRunner`）
- [ ] `grep -n 'books.beancount' apps/obsidian-plugin/tests/fava.test.ts` 有匹配（缺失场景已补）
- [ ] `git diff --name-only` 不含 `README.md`、`bench/`、`packages/`
- [ ] `CHANGELOG.md` 的 `## Unreleased` 有一行 Internal 提到 #74
- [ ] 没有改 out-of-scope 文件（`git status`）
- [ ] **不要**改 `plans/README.md`（Status 由编排者维护）

## STOP conditions

Stop and report back (do not improvise) if:

- 串行上 001–006 尚未合并，或 `apps/obsidian-plugin/vault-path.ts` 没有 `export function resolveInVault` 且返回类型不是 `{ ok: true; absPath: string } | { ok: false; reason: 'escape' }`。不要在本 PR 发明第三份路径函数，也不要把禁逃逸写进 `bean-check.ts`。
- Fava 生命周期已经不在 `main.ts`（别人抢先做了 #74）。
- 为了让测试绿，你觉得必须改 `waitForFavaReady` 的「status < 400」规则、超时杀进程、或对笔记 fence 启动 Fava。那些是 #76 已定行为，不是本计划的缺口。
- `FavaProcess` 似乎必须订阅 `settings` 或在端口变化时自动重启才能过测试。否决：`start` 吃快照；复用绑定端口 + 提示 Stop。
- 插件冒烟似乎必须保留 `favaRunner` 字段才能注入。改用 `plugin.fava = new FavaProcess(假 ports)`；不要把进程状态塞回 `BeancountPlugin`。
- 某步验证连续失败两次。
- 修复看起来必须改 out-of-scope 文件（parser、align、validation、clock.ts 实现）。
- 覆盖率跌破 90% 且只能靠测实现细节堆用例来凑（允许补 BDD 缺口，禁止为百分比测私有字段名）。

## Maintenance notes

- 以后改 Fava 产品行为（端口、就绪、fence）只动 `fava.ts` + `tests/fava.test.ts`。`main.ts` 应当继续只传快照。
- Reviewer 盯：是否还有第二份 `relative(root, …)`；是否 import 了 `clock.ts`；`dispose` vs `stop` 的 notice 差异；并发 start 是否只 spawn 一次；复用时 URL 是否仍是 **bound** port。
- 明确推迟：笔记 fence 当 Fava 目标（#75 已否）；运行中改端口自动重启（#75.10 已否）；统一 `loadPlugin`（A1.6 已否）。
- 不写 ADR（grill：Fava 不 watch settings 太小且 #75.10 已定）。
- 不往 `CONTEXT.md` 加「Fava process」（实现词）。
