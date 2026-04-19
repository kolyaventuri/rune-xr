import {afterEach, describe, expect, it, vi} from 'vitest'
import {sampleSceneSnapshot} from '@rune-xr/protocol'
import {createSceneMeshBuildRunner} from '../render/SceneMeshBuildRunner.js'

const originalWorker = globalThis.Worker

afterEach(() => {
  globalThis.Worker = originalWorker
  vi.restoreAllMocks()
})

describe('SceneMeshBuildRunner', () => {
  it('falls back to inline terrain builds when the worker fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    globalThis.Worker = class FailingWorker {
      private readonly listeners = new Map<string, Array<(event: any) => void>>()

      addEventListener(type: string, listener: (event: any) => void) {
        const listeners = this.listeners.get(type) ?? []

        listeners.push(listener)
        this.listeners.set(type, listeners)
      }

      postMessage() {
        for (const listener of this.listeners.get('error') ?? []) {
          listener({
            message: 'worker failed',
            error: new Error('worker failed'),
          })
        }
      }

      terminate() {}
    } as unknown as typeof Worker

    const runner = createSceneMeshBuildRunner()
    const data = await runner.buildTerrain({
      baseX: sampleSceneSnapshot.baseX,
      baseY: sampleSceneSnapshot.baseY,
      tiles: sampleSceneSnapshot.tiles,
    })

    expect(data.color?.positions.length ?? 0).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalledWith(
      'Scene mesh worker failed, falling back to inline mesh builds.',
      expect.any(Error),
    )
  })
})
