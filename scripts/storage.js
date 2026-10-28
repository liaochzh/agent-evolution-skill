const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { TARGET_VERSION } = require('./shared');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createDefaultState() {
  return {
    version: TARGET_VERSION,
    rules: {},
    identity: { role: "", traits: [], version: 1, history: [], updatedAt: "" },
    patterns: {},
    logs: [],
    errors: {},
    insights: {},
    lessons: {},
    events: [],
    assessments: { updated_at: "" },
    reviews: [],
    config: {
      thresholds: {
        repeatCount: 5,
        repeatWindowMinutes: 10,
        driftMatchScore: 0.3
      },
      limits: {
        maxLogs: 1000,
        maxErrors: 500,
        maxInsights: 500,
        maxReviews: 200,
        maxLessons: 500,
        maxEvents: 1000
      },
      recall: {
        defaultLimit: 8,
        minConfidence: 0.5,
        rulesLimit: 5
      },
      lifecycle: {
        activateConfidence: 0.6,
        retireConfidence: 0.2,
        maxConfidence: 0.95,
        halfLifeDays: 30,
        maxEvidence: 20,
        globalMinConfidence: 0.8
      },
      privacy: {
        redactLogs: true
      }
    }
  };
}

class Storage {
  constructor(filePath) {
    this.filePath = filePath;
    this.dir = path.dirname(filePath);
  }

  static getProjectRoot() {
    try {
      // 获取 Git 仓库根目录
      const gitRoot = execSync('git rev-parse --show-toplevel', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      return gitRoot;
    } catch {
      // 非 Git 仓库：回退到当前工作目录
      return process.cwd();
    }
  }

  static getDefaultStatePath() {
    // 环境变量直接指定完整路径时，直接使用
    if (process.env.AGENT_EVOLUTION_STATE) {
      return process.env.AGENT_EVOLUTION_STATE;
    }
    const root = Storage.getProjectRoot();
    return path.join(root, '.opencode', 'agent-evolution', 'state.json');
  }

  /** 跨项目共享的经验库；只在显式 promote --global / 召回时读写 */
  static getGlobalStatePath() {
    if (process.env.AGENT_EVOLUTION_GLOBAL_STATE) {
      return process.env.AGENT_EVOLUTION_GLOBAL_STATE;
    }
    const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    return path.join(base, 'agent-evolution', 'global.json');
  }

  load() {
    let parsed;
    try {
      const data = fs.readFileSync(this.filePath, 'utf8');
      parsed = JSON.parse(data);
    } catch (e) {
      if (e.code === 'ENOENT') return createDefaultState();
      if (e instanceof SyntaxError) {
        throw new Error(`State file is not valid JSON: ${this.filePath}. Fix or restore from a .bak file.`);
      }
      throw e;
    }

    if (parsed && parsed.version !== TARGET_VERSION) {
      this.backupBeforeMigration(parsed.version);
    }
    return this.migrate(parsed);
  }

  /** 版本升级前留一份不可覆盖的备份，避免数据丢失 */
  backupBeforeMigration(fromVersion) {
    try {
      const backupPath = `${this.filePath}.v${fromVersion || 'unknown'}.bak`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(this.filePath, backupPath);
      }
    } catch {
      // 备份失败不阻塞读取，真正的写入仍有原子替换
    }
  }

  save(data) {
    this.enforceLimits(data);
    fs.mkdirSync(this.dir, { recursive: true });

    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.filePath);
  }

  defaultState() {
    return createDefaultState();
  }

  /**
   * 迁移 + 归一化：无论 1.0 / 2.0 还是残缺文件，都补齐到当前结构。
   * 比按版本号逐个跳转更耐脏数据。
   */
  migrate(data) {
    const defaults = this.defaultState();
    const source = isPlainObject(data) ? data : {};

    const state = {
      ...defaults,
      ...source,
      version: TARGET_VERSION
    };

    for (const key of ['rules', 'patterns', 'errors', 'insights', 'lessons']) {
      state[key] = isPlainObject(source[key]) ? source[key] : {};
    }
    for (const key of ['logs', 'events', 'reviews']) {
      state[key] = Array.isArray(source[key]) ? source[key] : [];
    }

    state.identity = { ...defaults.identity, ...(isPlainObject(source.identity) ? source.identity : {}) };
    if (!Array.isArray(state.identity.traits)) state.identity.traits = [];
    if (!Array.isArray(state.identity.history)) state.identity.history = [];

    state.assessments = isPlainObject(source.assessments) ? { ...source.assessments } : { updated_at: "" };

    const config = isPlainObject(source.config) ? source.config : {};
    state.config = {
      ...defaults.config,
      ...config,
      thresholds: { ...defaults.config.thresholds, ...(isPlainObject(config.thresholds) ? config.thresholds : {}) },
      limits: { ...defaults.config.limits, ...(isPlainObject(config.limits) ? config.limits : {}) },
      recall: { ...defaults.config.recall, ...(isPlainObject(config.recall) ? config.recall : {}) },
      lifecycle: { ...defaults.config.lifecycle, ...(isPlainObject(config.lifecycle) ? config.lifecycle : {}) },
      privacy: { ...defaults.config.privacy, ...(isPlainObject(config.privacy) ? config.privacy : {}) }
    };

    // 老数据字段补齐，避免下游 toFixed/运算拿到 undefined
    for (const rule of Object.values(state.rules)) {
      if (!isPlainObject(rule)) continue;
      rule.weight = Number.isFinite(rule.weight) ? rule.weight : 1;
      rule.executions = Number.isFinite(rule.executions) ? rule.executions : 0;
      rule.violations = Number.isFinite(rule.violations) ? rule.violations : 0;
    }
    for (const lesson of Object.values(state.lessons)) {
      if (!isPlainObject(lesson)) continue;
      lesson.confidence = Number.isFinite(lesson.confidence) ? lesson.confidence : 0.5;
      lesson.status = lesson.status || 'pending';
      lesson.evidence = Array.isArray(lesson.evidence) ? lesson.evidence : [];
      lesson.helpful = Number.isFinite(lesson.helpful) ? lesson.helpful : 0;
      lesson.harmful = Number.isFinite(lesson.harmful) ? lesson.harmful : 0;
    }

    return state;
  }

  enforceLimits(state) {
    const limits = state.config?.limits || {};
    const timestamp = (value) => {
      const ts = new Date(value || 0).getTime();
      return Number.isFinite(ts) ? ts : 0;
    };
    const asArray = (value) => (Array.isArray(value) ? value : []);

    state.logs = asArray(state.logs);
    state.events = asArray(state.events);
    state.reviews = asArray(state.reviews);
    state.errors = isPlainObject(state.errors) ? state.errors : {};
    state.insights = isPlainObject(state.insights) ? state.insights : {};
    state.lessons = isPlainObject(state.lessons) ? state.lessons : {};

    if (limits.maxLogs && state.logs.length > limits.maxLogs) {
      state.logs = state.logs.slice(-limits.maxLogs);
    }
    if (limits.maxErrors && Object.keys(state.errors).length > limits.maxErrors) {
      const keys = Object.keys(state.errors).sort((a, b) =>
        timestamp(state.errors[a]?.created_at) - timestamp(state.errors[b]?.created_at)
      );
      const toDelete = keys.slice(0, keys.length - limits.maxErrors);
      toDelete.forEach(k => delete state.errors[k]);
    }
    if (limits.maxInsights && Object.keys(state.insights).length > limits.maxInsights) {
      const keys = Object.keys(state.insights).sort((a, b) =>
        timestamp(state.insights[a]?.created_at) - timestamp(state.insights[b]?.created_at)
      );
      const toDelete = keys.slice(0, keys.length - limits.maxInsights);
      toDelete.forEach(k => delete state.insights[k]);
    }
    if (limits.maxLessons && Object.keys(state.lessons).length > limits.maxLessons) {
      const statusRank = (lesson) => {
        if (!lesson) return 0;
        if (lesson.status === 'retired') return 0;
        if (lesson.status === 'pending') return 1;
        return 2;
      };
      const keys = Object.keys(state.lessons).sort((a, b) => {
        const left = state.lessons[a] || {};
        const right = state.lessons[b] || {};
        return statusRank(left) - statusRank(right)
          || (left.confidence || 0) - (right.confidence || 0)
          || timestamp(left.created_at) - timestamp(right.created_at);
      });
      keys.slice(0, keys.length - limits.maxLessons).forEach(k => delete state.lessons[k]);
    }
    if (limits.maxReviews && state.reviews.length > limits.maxReviews) {
      state.reviews = state.reviews.slice(-limits.maxReviews);
    }
    if (limits.maxEvents && state.events.length > limits.maxEvents) {
      state.events = state.events.slice(-limits.maxEvents);
    }
    return state;
  }
}

module.exports = { Storage, createDefaultState };
