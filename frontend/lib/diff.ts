export type DiffRow = {
  left: string
  right: string
  kind: 'equal' | 'add' | 'remove' | 'change'
}

export function buildLineDiff(aText: string, bText: string): DiffRow[] {
  const a = splitLines(aText)
  const b = splitLines(bText)

  const ops = diffLcs(a, b)

  const rows: DiffRow[] = []
  let pendingRemoves: string[] = []
  let pendingAdds: string[] = []

  const flush = () => {
    const n = Math.max(pendingRemoves.length, pendingAdds.length)
    for (let i = 0; i < n; i++) {
      const left = pendingRemoves[i] ?? ''
      const right = pendingAdds[i] ?? ''
      rows.push({
        left,
        right,
        kind: left && right ? 'change' : left ? 'remove' : 'add',
      })
    }
    pendingRemoves = []
    pendingAdds = []
  }

  for (const op of ops) {
    if (op.type === 'equal') {
      flush()
      for (const v of op.values) rows.push({ left: v, right: v, kind: 'equal' })
      continue
    }
    if (op.type === 'remove') {
      pendingRemoves.push(...op.values)
      continue
    }
    pendingAdds.push(...op.values)
  }
  flush()
  return rows
}

type DiffOp<T> = { type: 'equal' | 'add' | 'remove'; values: T[] }

function splitLines(s: string): string[] {
  const out = s.replace(/\r\n/g, '\n').split('\n')
  if (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

function diffLcs(a: string[], b: string[]): DiffOp<string>[] {
  const n = a.length
  const m = b.length

  if (n === 0 && m === 0) return []
  if (n === 0) return [{ type: 'add', values: b.slice() }]
  if (m === 0) return [{ type: 'remove', values: a.slice() }]

  const maxCells = 2_000_000
  if ((n + 1) * (m + 1) > maxCells) {
    return [
      { type: 'remove', values: a.slice() },
      { type: 'add', values: b.slice() },
    ]
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const ops: DiffOp<string>[] = []
  const push = (type: DiffOp<string>['type'], v: string) => {
    const last = ops[ops.length - 1]
    if (last && last.type === type) last.values.push(v)
    else ops.push({ type, values: [v] })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i])
      i++
      j++
      continue
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('remove', a[i])
      i++
    } else {
      push('add', b[j])
      j++
    }
  }
  while (i < n) {
    push('remove', a[i])
    i++
  }
  while (j < m) {
    push('add', b[j])
    j++
  }

  return ops
}
