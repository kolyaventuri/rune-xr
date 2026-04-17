import './benchmarkPage.css'
import {
  defaultMeshBenchmarkOptions,
  runMeshBenchmarkScenario,
  type MeshBenchmarkResult,
} from './meshBenchmarks.js'
import {meshBenchmarkScenarios} from './meshBenchmarkScenarios.js'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Benchmark page root not found.')
}

root.innerHTML = `
  <main class="benchmark-shell">
    <section class="benchmark-hero">
      <p class="benchmark-label">Rune XR</p>
      <h1 class="benchmark-title">Mesh Benchmark Harness</h1>
      <p class="benchmark-copy">
        This page runs the current TypeScript terrain and object mesh builders against the three synthetic
        workloads defined in <code>WASM_PLAN.md</code>. Use it in desktop Chrome or Quest Browser to compare
        the baseline before workerization or WASM work lands.
      </p>
      <div class="benchmark-toolbar">
        <button type="button" class="benchmark-button" data-run-benchmarks>Run Benchmarks</button>
        <span class="benchmark-status" data-benchmark-status>Idle</span>
      </div>
    </section>
    <section class="benchmark-grid">
      <article class="benchmark-panel">
        <h2>Environment</h2>
        <div class="benchmark-meta" data-benchmark-meta></div>
      </article>
      <section class="benchmark-result-list" data-benchmark-results>
        <article class="benchmark-panel benchmark-empty">
          Results will appear here after the first run.
        </article>
      </section>
    </section>
  </main>
`

const metaElementCandidate = root.querySelector<HTMLElement>('[data-benchmark-meta]')
const resultsElementCandidate = root.querySelector<HTMLElement>('[data-benchmark-results]')
const statusElementCandidate = root.querySelector<HTMLElement>('[data-benchmark-status]')
const runButtonCandidate = root.querySelector<HTMLButtonElement>('[data-run-benchmarks]')

if (!metaElementCandidate || !resultsElementCandidate || !statusElementCandidate || !runButtonCandidate) {
  throw new Error('Benchmark page is missing required elements.')
}

const metaElement = metaElementCandidate
const resultsElement = resultsElementCandidate
const statusElement = statusElementCandidate
const runButton = runButtonCandidate

metaElement.innerHTML = renderMetricCards({
  userAgent: navigator.userAgent,
  hardwareThreads: navigator.hardwareConcurrency,
  scenarios: meshBenchmarkScenarios.length,
  warmupIterations: defaultMeshBenchmarkOptions.warmupIterations,
  measuredIterations: defaultMeshBenchmarkOptions.measuredIterations,
})

runButton.addEventListener('click', () => {
  void runBenchmarks()
})

void runBenchmarks()

async function runBenchmarks() {
  runButton.disabled = true
  resultsElement.innerHTML = ''
  updateStatus('Running benchmark harness...')

  const results: MeshBenchmarkResult[] = []

  for (const [index, scenario] of meshBenchmarkScenarios.entries()) {
    updateStatus(`Running ${scenario.label} (${index + 1}/${meshBenchmarkScenarios.length})`)
    await nextFrame()
    results.push(runMeshBenchmarkScenario(scenario, defaultMeshBenchmarkOptions))
    resultsElement.innerHTML = results.map(renderResultCard).join('')
  }

  updateStatus(`Completed ${new Date().toLocaleTimeString()}`)
  runButton.disabled = false
}

function updateStatus(message: string) {
  statusElement.textContent = message
}

function renderResultCard(result: MeshBenchmarkResult) {
  return `
    <article class="benchmark-panel">
      <p class="benchmark-label">${result.kind === 'terrain' ? 'Terrain builder' : 'Object builder'}</p>
      <h3>${result.label}</h3>
      <p>${result.summary}</p>
      <div class="benchmark-stats">
        ${renderMetricCards({
          meanMs: `${formatMilliseconds(result.meanMs)} ms`,
          p50Ms: `${formatMilliseconds(result.p50Ms)} ms`,
          p95Ms: `${formatMilliseconds(result.p95Ms)} ms`,
          maxMs: `${formatMilliseconds(result.maxMs)} ms`,
        })}
      </div>
      <div class="benchmark-details">
        ${renderMetricCards(result.details)}
        ${renderMetricCards(result.outputMetrics)}
      </div>
    </article>
  `
}

function renderMetricCards(record: Record<string, number | string>) {
  return Object.entries(record)
    .map(([key, value]) => `
      <div class="benchmark-detail">
        <span class="benchmark-label">${formatLabel(key)}</span>
        <span class="benchmark-value">${formatValue(value)}</span>
      </div>
    `)
    .join('')
}

function formatLabel(value: string) {
  return value
    .replaceAll(/([A-Z])/g, ' $1')
    .replaceAll('-', ' ')
    .trim()
}

function formatValue(value: number | string) {
  if (typeof value === 'number') {
    return value.toLocaleString('en-US')
  }

  return value
}

function formatMilliseconds(value: number) {
  return value.toFixed(2)
}

function nextFrame() {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}
