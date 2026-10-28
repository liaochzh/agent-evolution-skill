const { parseArgs, flagNumber, similarity } = require('./shared');

const KINDS = ['lessons', 'errors', 'insights', 'rules'];

function textOf(kind, item) {
  if (kind === 'lessons') return `${item.trigger} ${item.action}`;
  if (kind === 'errors') return `${item.title} ${item.root_cause} ${item.solution}`;
  if (kind === 'insights') return `${item.problem} ${item.pattern} ${item.solution}`;
  return item.description || '';
}

function groupDuplicates(entries, threshold) {
  const parent = entries.map((_, index) => index);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (similarity(entries[i].text, entries[j].text) >= threshold) {
        union(i, j);
      }
    }
  }

  const buckets = new Map();
  entries.forEach((entry, index) => {
    const root = find(index);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(entry);
  });

  return [...buckets.values()].filter(group => group.length > 1);
}

function register(registry, storage) {
  registry['dedupe'] = (...args) => {
    const { flags } = parseArgs(args);
    const threshold = flagNumber(flags.threshold, 0.55);
    const requested = flags.kind && flags.kind !== 'all'
      ? [flags.kind]
      : KINDS;

    for (const kind of requested) {
      if (!KINDS.includes(kind)) {
        throw new Error(`Invalid kind: ${kind}. Use one of: ${KINDS.join(', ')}, all`);
      }
    }

    const state = storage.load();
    const clusters = [];
    let scanned = 0;

    for (const kind of requested) {
      const collection = state[kind] || {};
      const entries = [];
      for (const [id, item] of Object.entries(collection)) {
        if (kind === 'lessons' && item.status === 'retired') continue;
        entries.push({
          id,
          text: textOf(kind, item),
          confidence: item.confidence || 0,
          weight: item.weight || 0
        });
      }
      scanned += entries.length;

      for (const group of groupDuplicates(entries, threshold)) {
        const sorted = [...group].sort((a, b) =>
          (b.confidence - a.confidence) || (b.weight - a.weight)
        );
        const keep = sorted[0].id;
        clusters.push({
          kind,
          ids: group.map(entry => entry.id),
          suggested_keep: keep,
          hint: kind === 'lessons'
            ? (sorted.length > 2
              ? `lesson-merge ${keep} ${sorted[1].id}（其余逐条合并，一次只接受两个 id）`
              : `lesson-merge ${keep} ${sorted[1].id}`)
            : '人工比对后保留一条'
        });
      }
    }

    return { threshold, scanned, clusterCount: clusters.length, clusters };
  };
}

module.exports = { register, groupDuplicates, textOf, KINDS };
