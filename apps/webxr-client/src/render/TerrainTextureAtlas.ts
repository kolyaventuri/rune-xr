import {
  ClampToEdgeWrapping,
  DataTexture,
  NearestFilter,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three'
import type {TextureDefinition} from '@rune-xr/protocol'

export const TERRAIN_TEXTURE_SLOT_SIZE = 128
export const TERRAIN_TEXTURE_GRID_SIZE = 16
export const TERRAIN_TEXTURE_ATLAS_SIZE = TERRAIN_TEXTURE_SLOT_SIZE * TERRAIN_TEXTURE_GRID_SIZE
const MAX_TERRAIN_TEXTURE_ID = (TERRAIN_TEXTURE_GRID_SIZE * TERRAIN_TEXTURE_GRID_SIZE) - 1

export class TerrainTextureAtlas {
  readonly texture: DataTexture
  private readonly data = new Uint8Array(TERRAIN_TEXTURE_ATLAS_SIZE * TERRAIN_TEXTURE_ATLAS_SIZE * 4)
  private readonly objectTextures = new Map<number, {data: Uint8Array; texture: DataTexture}>()
  private readonly loadedObjectTextureIds = new Set<number>()

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
    const updatedObjectTextureIds: number[] = []

    for (const texture of textures) {
      if (!isObjectTextureId(texture.id) || texture.width !== TERRAIN_TEXTURE_SLOT_SIZE || texture.height !== TERRAIN_TEXTURE_SLOT_SIZE) {
        continue
      }

      const pixels = await decodeTexturePixels(texture)

      if (!pixels) {
        continue
      }

      const flippedPixels = flipTexturePixels(pixels)

      if (isTerrainTextureId(texture.id)) {
        writeTextureSlot(this.data, texture.id, flippedPixels)
        changed = true
      }

      this.upsertObjectTexture(texture.id, flippedPixels)
      this.loadedObjectTextureIds.add(texture.id)
      updatedObjectTextureIds.push(texture.id)
    }

    if (changed) {
      this.texture.needsUpdate = true
    }

    return updatedObjectTextureIds
  }

  getObjectTexture(textureId: number) {
    if (!isObjectTextureId(textureId)) {
      return undefined
    }

    let entry = this.objectTextures.get(textureId)

    if (!entry) {
      entry = createObjectTextureEntry(textureId)
      this.objectTextures.set(textureId, entry)
    }

    return entry.texture
  }

  hasObjectTexture(textureId: number) {
    return this.loadedObjectTextureIds.has(textureId)
  }

  private upsertObjectTexture(textureId: number, pixels: Uint8Array) {
    let entry = this.objectTextures.get(textureId)

    if (!entry) {
      entry = createObjectTextureEntry(textureId)
      this.objectTextures.set(textureId, entry)
    }

    entry.data.set(pixels)
    entry.texture.needsUpdate = true
  }
}

export function isTerrainTextureId(textureId: number | undefined): textureId is number {
  return typeof textureId === 'number'
    && Number.isInteger(textureId)
    && textureId >= 0
    && textureId <= MAX_TERRAIN_TEXTURE_ID
}

export function isObjectTextureId(textureId: number | undefined): textureId is number {
  return typeof textureId === 'number'
    && Number.isInteger(textureId)
    && textureId >= 0
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

function writeTextureSlot(target: Uint8Array, textureId: number, pixels: Uint8Array) {
  const slotX = (textureId % TERRAIN_TEXTURE_GRID_SIZE) * TERRAIN_TEXTURE_SLOT_SIZE
  const slotY = Math.floor(textureId / TERRAIN_TEXTURE_GRID_SIZE) * TERRAIN_TEXTURE_SLOT_SIZE

  for (let y = 0; y < TERRAIN_TEXTURE_SLOT_SIZE; y += 1) {
    for (let x = 0; x < TERRAIN_TEXTURE_SLOT_SIZE; x += 1) {
      const sourceOffset = ((y * TERRAIN_TEXTURE_SLOT_SIZE) + x) * 4
      const destinationOffset = (((slotY + y) * TERRAIN_TEXTURE_ATLAS_SIZE) + slotX + x) * 4

      target[destinationOffset] = pixels[sourceOffset] ?? 0
      target[destinationOffset + 1] = pixels[sourceOffset + 1] ?? 0
      target[destinationOffset + 2] = pixels[sourceOffset + 2] ?? 0
      target[destinationOffset + 3] = pixels[sourceOffset + 3] ?? 0
    }
  }
}

function createObjectTextureEntry(textureId: number) {
  const data = new Uint8Array(TERRAIN_TEXTURE_SLOT_SIZE * TERRAIN_TEXTURE_SLOT_SIZE * 4)
  const texture = new DataTexture(
    data,
    TERRAIN_TEXTURE_SLOT_SIZE,
    TERRAIN_TEXTURE_SLOT_SIZE,
    RGBAFormat,
    UnsignedByteType,
  )

  texture.name = `object-texture-${textureId}`
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  return {data, texture}
}

function flipTexturePixels(source: Uint8ClampedArray) {
  const flipped = new Uint8Array(source.length)

  for (let sourceY = 0; sourceY < TERRAIN_TEXTURE_SLOT_SIZE; sourceY += 1) {
    const destinationY = TERRAIN_TEXTURE_SLOT_SIZE - 1 - sourceY

    for (let sourceX = 0; sourceX < TERRAIN_TEXTURE_SLOT_SIZE; sourceX += 1) {
      const sourceOffset = ((sourceY * TERRAIN_TEXTURE_SLOT_SIZE) + sourceX) * 4
      const destinationOffset = ((destinationY * TERRAIN_TEXTURE_SLOT_SIZE) + sourceX) * 4

      flipped[destinationOffset] = source[sourceOffset] ?? 0
      flipped[destinationOffset + 1] = source[sourceOffset + 1] ?? 0
      flipped[destinationOffset + 2] = source[sourceOffset + 2] ?? 0
      flipped[destinationOffset + 3] = source[sourceOffset + 3] ?? 0
    }
  }

  return flipped
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
