import {
  defaultMeshBenchmarkOptions,
  runMeshBenchmarks,
  type MeshBenchmarkResult,
} from './meshBenchmarks.js'

const results = runMeshBenchmarks(defaultMeshBenchmarkOptions)

console.log('Rune XR mesh benchmarks (TypeScript builders)')
console.log(
  `Warmup iterations: ${defaultMeshBenchmarkOptions.warmupIterations}, `
  + `measured iterations: ${defaultMeshBenchmarkOptions.measuredIterations}`,
)
console.table(results.map(result => formatResultRow(result)))

for (const result of results) {
  console.log(`${result.label}: ${formatDetailRecord(result.details)} | ${formatDetailRecord(result.outputMetrics)}`)
}

function formatResultRow(result: MeshBenchmarkResult) {
  return {
    scenario: result.id,
    meanMs: formatMilliseconds(result.meanMs),
    p50Ms: formatMilliseconds(result.p50Ms),
    p95Ms: formatMilliseconds(result.p95Ms),
    minMs: formatMilliseconds(result.minMs),
    maxMs: formatMilliseconds(result.maxMs),
    totalVertices: result.outputMetrics.totalVertices.toLocaleString('en-US'),
  }
}

function formatDetailRecord(record: Record<string, number>) {
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value.toLocaleString('en-US')}`)
    .join(', ')
}

function formatMilliseconds(value: number) {
  return value.toFixed(2)
}
