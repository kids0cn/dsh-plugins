import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * dsh-cc-hooks —— Claude Code hooks 的 DSH 原生迁移（2026-10-07 用户拍板：不走桥）。
 *
 * 迁移对照（执行体全部复用 ~/.claude/hooks/ 下的原脚本，与 Claude Code 侧单一事实源、零漂移；
 * 原生只负责「触发时机 + stdin 喂参 + 命名日志」）：
 *   SessionStart  → task-start-snapshot.sh capture（任务前 WIP 快照；Claude 侧其实从未接线，本次补上）
 *                 + hermes-context.js（共享记忆索引注入，每 session 一次，先于首次请求 await 完成）
 *   PostToolUse   → post-edit-commit.sh（write|edit 后只 git add；stdin {session_id, cwd}）
 *   Stop          → stop-commit.sh（turn 结束兜底提交 + 日报）
 *
 * 触发点（均为 DSH 原生 cordis 事件，全部实证可用或文档化待验）：
 *   agent/pre-step 且 step===1 → session-start 三件套（等价 SessionStart startup/resume；
 *     进程重启同 session 会再注入一次 = resume 语义；compact 后不重注是已知缺口）
 *   tools/post-execute → 写/改文件后同步等 git add 完成（与 Claude 同为阻塞语义）
 *   turn/end → 等价 Claude Stop（每个回合结束都会触发，非仅会话关闭）
 *
 * 命名日志（2026-10-07 用户要求：别的功能要统计实时 hook，日志必须带 hook 名字）：
 *   1) 会话事件流：session.append("hook/invoked"/"hook/result", {point, dialect:'native',
 *      handlerId:<脚本名>}）—— 与桥同事件名同形状，但 handlerId 是配置里的真实名字而非序号；
 *   2) 文件兜底：~/.dsh/hooks-stats.jsonl 每行一条 JSON —— 事件流不可用时的硬保证。
 *
 * 纪律（与 dsh-guards 同款）：监听器体全程 try/catch，绝不把异常抛成工具 isError；
 * 子进程超时即杀，失败只记日志不打断主流程。零裸导入，只用 node: 内置包。
 */

const HOME = homedir();
const HOOKS = path.join(HOME, '.claude', 'hooks');
const STATS_LOG = path.join(HOME, '.dsh', 'hooks-stats.jsonl');

/** 本进程内已做过 session-start 的 session id（resume = 进程重启，Set 是新的 → 自然重注入）。 */
const started = new Set();
/** turn/end payload 不带 agent 时的兜底引用（每次 pre-step 刷新）。 */
let lastAgent = null;

/** 构造注入消息：与 dsh-guards/桥同形状（id/role/content/source）。 */
function ctxMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-cc-hooks' }
  };
}

/**
 * 命名 hook 日志：文件（硬保证）+ 会话事件流（实时，喂给统计功能）。
 * rec: { point, handler, decision, matcher?, exitCode?, ms?, stderr? }
 */
function logRec(agent, rec) {
  const sid = agent?.session?.header?.id ?? 'unknown';
  try {
    appendFileSync(STATS_LOG, JSON.stringify({ ts: new Date().toISOString(), sessionId: sid, ...rec }) + '\n');
  } catch { /* 日志失败不影响主流程 */ }
  try {
    const s = agent?.session;
    if (s && typeof s.append === 'function') {
      const invoked = { point: rec.point, dialect: 'native', handlerId: rec.handler };
      if (rec.matcher) invoked.matcher = rec.matcher;
      s.append('hook/invoked', invoked);
      const result = { point: rec.point, handlerId: rec.handler, decision: rec.decision };
      if (rec.ms !== undefined) result.ms = rec.ms;
      if (rec.exitCode !== undefined) result.exitCode = rec.exitCode;
      if (rec.stderr) result.stderr = String(rec.stderr).slice(0, 500);
      s.append('hook/result', result);
    }
  } catch { /* 事件流不可用 → 文件日志兜底 */ }
}

/**
 * 跑一个 hook 脚本并记命名日志。永不 reject：一切异常折叠成 { ok:false }。
 * @returns { ok, exitCode?, out, err, ms }
 */
function runCmd(cmd, args, { agent, input, env, timeoutMs = 15000, point, handler, matcher } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const cwd = agent?.session?.header?.cwd || process.cwd();
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      const rec = { point, handler, decision: r.ok ? 'pass' : 'fail', ms: Date.now() - t0 };
      if (matcher) rec.matcher = matcher;
      if (r.exitCode !== undefined) rec.exitCode = r.exitCode;
      if (!r.ok && r.err) rec.stderr = r.err;
      logRec(agent, rec);
      resolve(r);
    };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ ok: false, err: String(e), ms: Date.now() - t0 });
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
      finish({ ok: false, exitCode: -1, err: `timeout ${timeoutMs}ms`, out, err });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, err: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); finish({ ok: code === 0, exitCode: code ?? -1, out, err }); });
    try {
      child.stdin.write(JSON.stringify(input ?? { session_id: agent?.session?.header?.id ?? '', cwd }));
      child.stdin.end();
    } catch { /* 脚本不读 stdin 时 EPIPE，忽略 */ }
  });
}

/** SessionStart 等价物：WIP 快照 + 共享记忆索引注入，每 session 只跑一次，先于首次模型请求完成。 */
async function sessionStart(agent) {
  const sid = agent?.session?.header?.id;
  if (!sid || started.has(sid)) return;
  started.add(sid);
  const cwd = agent?.session?.header?.cwd ?? '';
  await Promise.all([
    runCmd('bash', [path.join(HOOKS, 'task-start-snapshot.sh')], {
      agent, input: { session_id: sid, cwd },
      point: 'SessionStart', handler: 'task-start-snapshot.sh', timeoutMs: 8000
    }),
    (async () => {
      const r = await runCmd('node', [path.join(HOOKS, 'hermes-context.js')], {
        agent, env: { CLAUDE_PROJECT_DIR: cwd },
        point: 'SessionStart', handler: 'hermes-context.js', timeoutMs: 3000
      });
      let text = null;
      try { text = JSON.parse(r.out || '')?.hookSpecificOutput?.additionalContext ?? null; } catch { /* 非 JSON */ }
      if (text) {
        try { agent?.inject?.(ctxMessage(text)); } catch (e) { console.error('[dsh-cc-hooks] inject:', e); }
      }
    })()
  ]);
}

export function apply(ctx) {
  try {
    appendFileSync(STATS_LOG, JSON.stringify({
      ts: new Date().toISOString(), sessionId: 'boot',
      point: 'plugin/apply', handlerId: 'dsh-cc-hooks', decision: 'pass'
    }) + '\n');
  } catch { /* 记不到启动信标不影响功能 */ }

  // ≈ UserPromptSubmit/SessionStart：turn 首步做 session-start 三件套（await → 赶在首次请求前）
  const offPre = ctx.on('agent/pre-step', async (payload, next) => {
    try {
      if (payload?.agent) lastAgent = payload.agent;
      if (payload?.step === 1 && payload?.agent) await sessionStart(payload.agent);
    } catch (e) {
      console.error('[dsh-cc-hooks] pre-step failed:', e);
    }
    return next();
  });

  // ≈ PostToolUse Write|Edit：编辑后同步 git add（阻塞语义与 Claude 一致，验收可直接 git status）
  const offPost = ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next();
    try {
      const name = exec?.name;
      if (name === 'write' || name === 'edit') {
        await runCmd('bash', [path.join(HOOKS, 'post-edit-commit.sh')], {
          agent: exec?.agent,
          point: 'PostToolUse', handler: 'post-edit-commit.sh', matcher: 'write|edit',
          timeoutMs: 15000
        });
      }
    } catch (e) {
      console.error('[dsh-cc-hooks] post-execute failed:', e);
    }
    return downstream;
  });

  // ≈ Stop：每个 turn 结束跑兜底提交（Claude Stop 同语义；stop-commit 对无变更场景自动跳过）
  const offStop = ctx.on('turn/end', async (payload, next) => {
    try {
      const agent = payload?.agent ?? payload?.data?.agent ?? lastAgent;
      await runCmd('bash', [path.join(HOOKS, 'stop-commit.sh')], {
        agent,
        point: 'Stop', handler: 'stop-commit.sh',
        timeoutMs: 30000
      });
    } catch (e) {
      console.error('[dsh-cc-hooks] turn/end failed:', e);
    }
    return next();
  });

  return () => {
    if (typeof offPre === 'function') offPre();
    if (typeof offPost === 'function') offPost();
    if (typeof offStop === 'function') offStop();
  };
}
