import {ClampToEdgeWrapping, DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType} from 'three'
import type {TextureDefinition} from '@rune-xr/protocol'

export const TERRAIN_TEXTURE_SLOT_SIZE = 128
export const TERRAIN_TEXTURE_GRID_SIZE = 16
export const TERRAIN_TEXTURE_ATLAS_SIZE = TERRAIN_TEXTURE_SLOT_SIZE * TERRAIN_TEXTURE_GRID_SIZE
const MAX_TERRAIN_TEXTURE_ID = (TERRAIN_TEXTURE_GRID_SIZE * TERRAIN_TEXTURE_GRID_SIZE) - 1

export class TerrainTextureAtlas {
  readonly texture: DataTexture
  private readonly data = new Uint8Array(TERRAIN_TEXTURE_ATLAS_SIZE * TERRAIN_TEXTURE_ATLAS_SIZE * 4)

  constructor() {
    this.texture = new DataTexture(
      this.data,
      TERRAIN_TEXTURE_ATLAS_SIZE,
      TERRAIN_TEXTURE_ATLAS_SIZE,
      RGBAFormat,
      UnsignedByteType,
    )
    this.texture.name = 'terrain-texture-atlas'
    this.texture.colorSpace = SRGBColorSpace
    this.texture.wrapS = ClampToEdgeWrapping
    this.texture.wrapT = ClampToEdgeWrapping
    this.texture.magFilter = NearestFilter
    this.texture.minFilter = NearestFilter
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true
  }

  async upsertBatch(textures: TextureDefinition[]) {
    let changed = false

    for (const texture of textures) {
      if (!isTerrainTextureId(texture.id) || texture.width !== TERRAIN_TEXTURE_SLOT_SIZE || texture.height !== TERRAIN_TEXTURE_SLOT_SIZE) {
        continue
      }

      const pixels = await decodeTexturePixels(texture)

      if (!pixels) {
        continue
      }

      writeTextureSlot(this.data, texture.id, pixels)
      changed = true
    }

    if (changed) {
      this.texture.needsUpdate = true
    }
  }
}

export function isTerrainTextureId(textureId: number | undefined): textureId is number {
  return typeof textureId === 'number'
    && Number.isInteger(textureId)
    && textureId >= 0
    && textureId <= MAX_TERRAIN_TEXTURE_ID
}

export function getTerrainTextureSlotBounds(textureId: number) {
  if (!isTerrainTextureId(textureId)) {
    return undefined
  }

  const column = textureId % TERRAIN_TEXTURE_GRID_SIZE
  const row = Math.floor(textureId / TERRAIN_TEXTURE_GRID_SIZE)

  return {
    uMin: column / TERRAIN_TEXTURE_GRID_SIZE,
    uMax: (column + 1) / TERRAIN_TEXTURE_GRID_SIZE,
    vMin: row / TERRAIN_TEXTURE_GRID_SIZE,
    vMax: (row + 1) / TERRAIN_TEXTURE_GRID_SIZE,
  }
}

function writeTextureSlot(target: Uint8Array, textureId: number, pixels: Uint8ClampedArray) {
  const slotX = (textureId % TERRAIN_TEXTURE_GRID_SIZE) * TERRAIN_TEXTURE_SLOT_SIZE
  const slotY = Math.floor(textureId / TERRAIN_TEXTURE_GRID_SIZE) * TERRAIN_TEXTURE_SLOT_SIZE

  for (let sourceY = 0; sourceY < TERRAIN_TEXTURE_SLOT_SIZE; sourceY += 1) {
    const destinationY = slotY + (TERRAIN_TEXTURE_SLOT_SIZE - 1 - sourceY)

    for (let sourceX = 0; sourceX < TERRAIN_TEXTURE_SLOT_SIZE; sourceX += 1) {
      const sourceOffset = ((sourceY * TERRAIN_TEXTURE_SLOT_SIZE) + sourceX) * 4
      const destinationOffset = ((destinationY * TERRAIN_TEXTURE_ATLAS_SIZE) + slotX + sourceX) * 4

      target[destinationOffset] = pixels[sourceOffset] ?? 0
      target[destinationOffset + 1] = pixels[sourceOffset + 1] ?? 0
      target[destinationOffset + 2] = pixels[sourceOffset + 2] ?? 0
      target[destinationOffset + 3] = pixels[sourceOffset + 3] ?? 0
    }
  }
}

async function decodeTexturePixels(texture: TextureDefinition) {
  const image = await loadTextureImage(texture.pngBase64)

  if (!image) {
    return undefined
  }

  const surface = createDecodeSurface(texture.width, texture.height)

  if (!surface) {
    closeBitmap(image)
    return undefined
  }

  surface.context.clearRect(0, 0, texture.width, texture.height)
  surface.context.drawImage(image, 0, 0, texture.width, texture.height)
  const pixels = surface.context.getImageData(0, 0, texture.width, texture.height).data

  closeBitmap(image)

  return pixels
}

async function loadTextureImage(pngBase64: string) {
  const dataUrl = `data:image/png;base64,${pngBase64}`

  if (typeof fetch === 'function' && typeof createImageBitmap === 'function') {
    try {
      const response = await fetch(dataUrl)
      const blob = await response.blob()

      return await createImageBitmap(blob)
    } catch {}
  }

  if (typeof Image === 'undefined') {
    return undefined
  }

  return new Promise<HTMLImageElement | undefined>(resolve => {
    const image = new Image()

    image.addEventListener('load', () => {
      resolve(image)
    }, {once: true})
    image.addEventListener('error', () => {
      resolve(undefined)
    }, {once: true})
    image.src = dataUrl
  })
}

function createDecodeSurface(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d', {willReadFrequently: true})

    if (!context) {
      return undefined
    }

    return {context}
  }

  if (typeof document === 'undefined') {
    return undefined
  }

  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d', {willReadFrequently: true})

  if (!context) {
    return undefined
  }

  return {context}
}

function closeBitmap(image: ImageBitmap | HTMLImageElement) {
  if ('close' in image) {
    image.close()
  }
}
