import {describe, expect, it} from 'vitest'
import {runMeshBenchmarkScenario} from '../benchmark/meshBenchmarks.js'
import {meshBenchmarkScenarios} from '../benchmark/meshBenchmarkScenarios.js'

describe('mesh benchmark harness', () => {
  it('defines the planned benchmark workloads', () => {
    expect(meshBenchmarkScenarios.map(scenario => scenario.id)).toEqual([
      'large-flat-terrain',
      'modeled-terrain-seams',
      'model-heavy-objects',
    ])

    expect(meshBenchmarkScenarios[0]?.details).toMatchObject({
      tiles: 4225,
      cells: 4096,
      texturedCells: 4096,
    })
    expect(meshBenchmarkScenarios[1]?.details).toMatchObject({
      tiles: 1089,
      cells: 1024,
      modeledTiles: 512,
    })
    expect(meshBenchmarkScenarios[2]?.details).toMatchObject({
      objects: 150,
      facesPerObject: 256,
      totalFaces: 38400,
    })
  })

  it('runs each benchmark scenario and reports output metrics', () => {
    for (const scenario of meshBenchmarkScenarios) {
      const result = runMeshBenchmarkScenario(scenario, {
        warmupIterations: 0,
        measuredIterations: 1,
      })

      expect(result.samplesMs).toHaveLength(1)
      expect(result.outputMetrics.totalVertices).toBeGreaterThan(0)
      expect(result.maxMs).toBeGreaterThanOrEqual(result.minMs)
      expect(result.p95Ms).toBeGreaterThanOrEqual(result.p50Ms)
    }
  })
})
