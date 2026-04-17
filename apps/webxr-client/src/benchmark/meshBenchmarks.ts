import {Texture, type Mesh} from 'three'
import {buildObjectMeshes} from '../render/ObjectMeshBuilder.js'
import {buildTerrainMeshes} from '../render/TerrainMeshBuilder.js'
import {meshBenchmarkScenarios, type MeshBenchmarkScenario} from './meshBenchmarkScenarios.js'

const benchmarkTerrainTexture = new Texture()
const benchmarkObjectTexture = new Texture()

export type MeshBenchmarkOptions = {
  warmupIterations?: number;
  measuredIterations?: number;
}

export type MeshBenchmarkResult = {
  id: MeshBenchmarkScenario['id'];
  kind: MeshBenchmarkScenario['kind'];
  label: string;
  summary: string;
  details: Record<string, number>;
  outputMetrics: Record<string, number> & {totalVertices: number};
  samplesMs: number[];
  warmupIterations: number;
  measuredIterations: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
}

export const defaultMeshBenchmarkOptions = {
  warmupIterations: 5,
  measuredIterations: 30,
} satisfies Required<MeshBenchmarkOptions>

type BenchmarkArtifacts = {
  outputMetrics: Record<string, number> & {totalVertices: number};
  dispose: () => void;
}

export function runMeshBenchmarks(
  options: MeshBenchmarkOptions = {},
  scenarios: MeshBenchmarkScenario[] = meshBenchmarkScenarios,
) {
  return scenarios.map(scenario => runMeshBenchmarkScenario(scenario, options))
}

export function runMeshBenchmarkScenario(
  scenario: MeshBenchmarkScenario,
  options: MeshBenchmarkOptions = {},
): MeshBenchmarkResult {
  const {warmupIterations, measuredIterations} = resolveBenchmarkOptions(options)
  const baselineArtifacts = buildScenarioArtifacts(scenario)
  const outputMetrics = baselineArtifacts.outputMetrics

  baselineArtifacts.dispose()

  for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
    const artifacts = buildScenarioArtifacts(scenario)
    artifacts.dispose()
  }

  const samplesMs: number[] = []

  for (let iteration = 0; iteration < measuredIterations; iteration += 1) {
    const startedAt = performance.now()
    const artifacts = buildScenarioArtifacts(scenario)
    const durationMs = performance.now() - startedAt

    artifacts.dispose()
    samplesMs.push(durationMs)
  }

  const sortedSamples = [...samplesMs].sort((left, right) => left - right)

  return {
    id: scenario.id,
    kind: scenario.kind,
    label: scenario.label,
    summary: scenario.summary,
    details: scenario.details,
    outputMetrics,
    samplesMs,
    warmupIterations,
    measuredIterations,
    minMs: sortedSamples[0] ?? 0,
    maxMs: sortedSamples.at(-1) ?? 0,
    meanMs: average(samplesMs),
    p50Ms: quantile(sortedSamples, 0.5),
    p95Ms: quantile(sortedSamples, 0.95),
  }
}

function buildScenarioArtifacts(scenario: MeshBenchmarkScenario): BenchmarkArtifacts {
  if (scenario.kind === 'terrain') {
    const terrain = buildTerrainMeshes(scenario.snapshot, benchmarkTerrainTexture)
    const outputMetrics = {
      colorVertices: countVertices(terrain.colorMesh),
      texturedVertices: countVertices(terrain.texturedMesh),
      bridgeVertices: countVertices(terrain.bridgeDeckMesh),
    }

    return {
      outputMetrics: {
        ...outputMetrics,
        totalVertices: outputMetrics.colorVertices + outputMetrics.texturedVertices + outputMetrics.bridgeVertices,
      },
      dispose: () => {
        disposeMesh(terrain.colorMesh)
        disposeMesh(terrain.texturedMesh)
        disposeMesh(terrain.bridgeDeckMesh)
      },
    }
  }

  const objectMeshes = buildObjectMeshes(
    scenario.snapshot,
    scenario.snapshot.objects,
    () => benchmarkObjectTexture,
    () => true,
  )
  const texturedVertices = objectMeshes.texturedMeshes.reduce(
    (total, mesh) => total + countVertices(mesh),
    0,
  )

  return {
    outputMetrics: {
      colorVertices: countVertices(objectMeshes.colorMesh),
      texturedVertices,
      texturedMeshes: objectMeshes.texturedMeshes.length,
      totalVertices: countVertices(objectMeshes.colorMesh) + texturedVertices,
    },
    dispose: () => {
      disposeMesh(objectMeshes.colorMesh)

      for (const texturedMesh of objectMeshes.texturedMeshes) {
        disposeMesh(texturedMesh)
      }
    },
  }
}

function resolveBenchmarkOptions(options: MeshBenchmarkOptions) {
  return {
    warmupIterations: Math.max(0, Math.floor(options.warmupIterations ?? defaultMeshBenchmarkOptions.warmupIterations)),
    measuredIterations: Math.max(1, Math.floor(options.measuredIterations ?? defaultMeshBenchmarkOptions.measuredIterations)),
  }
}

function countVertices(mesh: Mesh | undefined) {
  return mesh?.geometry.getAttribute('position')?.count ?? 0
}

function disposeMesh(mesh: Mesh | undefined) {
  if (!mesh) {
    return
  }

  mesh.geometry.dispose()

  if (Array.isArray(mesh.material)) {
    for (const material of mesh.material) {
      material.dispose()
    }

    return
  }

  mesh.material.dispose()
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function quantile(sortedValues: number[], percentile: number) {
  if (sortedValues.length === 0) {
    return 0
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentile) - 1),
  )

  return sortedValues[index] ?? 0
}
