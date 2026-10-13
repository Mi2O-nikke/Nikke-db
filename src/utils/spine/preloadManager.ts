/**
 * Preload Manager for Spine Cover Mode
 * Handles parallel loading of cover + aim skeletons and essential voice files
 */

interface PreloadConfig {
  characterId: string
  includeVoice: boolean
}

interface PreloadCache {
  [key: string]: {
    buffer: ArrayBuffer
    timestamp: number
  }
}

// In-memory cache for preloaded assets
const preloadCache: PreloadCache = {}

// Track ongoing preload requests to avoid duplicates
const ongoingPreloads: { [key: string]: Promise<void> } = {}

/**
 * Get cache key for an asset
 */
const getCacheKey = (charId: string, type: 'cover' | 'aim', extension: 'skel' | 'atlas' | 'png' | 'ogg', voiceFile?: string): string => {
  if (extension === 'ogg' && voiceFile) {
    return `${charId}_voice_${voiceFile}`
  }
  return `${charId}_${type}_${extension}`
}

/**
 * Fetch and cache a file
 */
const fetchAndCache = async (url: string, cacheKey: string): Promise<ArrayBuffer> => {
  // Check if already cached
  if (preloadCache[cacheKey]) {
    console.log(`[Preload] Using cached: ${cacheKey}`)
    return preloadCache[cacheKey].buffer
  }

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const buffer = await response.arrayBuffer()
    
    // Cache the result
    preloadCache[cacheKey] = {
      buffer,
      timestamp: Date.now()
    }
    
    console.log(`[Preload] Cached: ${cacheKey} (${(buffer.byteLength / 1024).toFixed(1)}KB)`)
    return buffer
  } catch (error) {
    console.error(`[Preload] Failed to fetch ${url}:`, error)
    throw error
  }
}

/**
 * Preload essential voice files for cover mode
 */
const preloadVoiceFiles = async (charId: string): Promise<void> => {
  const voiceFiles = [
    'c090_fire.ogg',
    'c090_fire_echo.ogg',
    'c090_fire_loop.ogg',
    'c090_fire_spin.ogg',
    'c090_reload_1.ogg',
    'c090_reload_2.ogg',
    'c090_Reload_1.ogg'
  ]

  const baseCharId = charId.split('_')[0] // For variant support (c090_02 -> c090)
  
  const voicePromises = voiceFiles.map(async (voiceFile) => {
    // Try variant first, then fallback to base character
    const variantPath = `/assets/l2d/${charId}/voice/fx/${charId}_${voiceFile.replace('c090_', '')}`
    const basePath = `/assets/l2d/${baseCharId}/voice/fx/${voiceFile}`
    
    try {
      const cacheKey = getCacheKey(charId, 'cover', 'ogg', voiceFile)
      
      // Try variant path first
      try {
        await fetchAndCache(variantPath, cacheKey)
      } catch (e) {
        // Fallback to base character
        await fetchAndCache(basePath, cacheKey)
      }
    } catch (error) {
      console.warn(`[Preload] Could not load voice ${voiceFile}`)
    }
  })

  await Promise.all(voicePromises)
}

/**
 * Preload cover and aim skeletons + textures in parallel
 * Returns promise that resolves when all assets are cached
 */
export const preloadCoverModeAssets = async (charId: string, includeVoice: boolean = true): Promise<void> => {
  // Check if already preloading this character
  if (ongoingPreloads[charId]) {
    console.log(`[Preload] Already preloading ${charId}, reusing promise`)
    return ongoingPreloads[charId]
  }

  const preloadPromise = (async () => {
    try {
      console.log(`[Preload] Starting cover mode preload for ${charId}`)
      const startTime = performance.now()

      // Load cover and aim in parallel
      const skelPromises = [
        // Cover skeleton files
        fetchAndCache(
          `/assets/l2d/${charId}/cover/${charId}_cover_00.skel`,
          getCacheKey(charId, 'cover', 'skel')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/cover/${charId}_cover_00.atlas`,
          getCacheKey(charId, 'cover', 'atlas')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/cover/${charId}_cover_00.png`,
          getCacheKey(charId, 'cover', 'png')
        ),
        
        // Aim skeleton files
        fetchAndCache(
          `/assets/l2d/${charId}/aim/${charId}_aim_00.skel`,
          getCacheKey(charId, 'aim', 'skel')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/aim/${charId}_aim_00.atlas`,
          getCacheKey(charId, 'aim', 'atlas')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/aim/${charId}_aim_00.png`,
          getCacheKey(charId, 'aim', 'png')
        )
      ]

      // Wait for all skeletons to load
      await Promise.all(skelPromises)

      const skelTime = performance.now() - startTime
      console.log(`[Preload] Skeleton files cached in ${skelTime.toFixed(0)}ms`)

      // Optionally preload voice files in background (non-blocking)
      if (includeVoice) {
        preloadVoiceFiles(charId).catch(e => {
          console.warn('[Preload] Voice preload had errors:', e)
        })
      }

      const totalTime = performance.now() - startTime
      console.log(`[Preload] ✅ Preload complete for ${charId} (${totalTime.toFixed(0)}ms)`)
    } catch (error) {
      console.error('[Preload] ❌ Preload failed:', error)
      throw error
    }
  })()

  ongoingPreloads[charId] = preloadPromise
  return preloadPromise
}

/**
 * Get cached asset buffer
 */
export const getCachedAsset = (cacheKey: string): ArrayBuffer | null => {
  return preloadCache[cacheKey]?.buffer || null
}

/**
 * Check if character assets are preloaded
 */
export const isPreloaded = (charId: string): boolean => {
  const coverSkelKey = getCacheKey(charId, 'cover', 'skel')
  const aimSkelKey = getCacheKey(charId, 'aim', 'skel')
  return !!(preloadCache[coverSkelKey] && preloadCache[aimSkelKey])
}

/**
 * Clear cache for a character
 */
export const clearCharacterCache = (charId: string): void => {
  Object.keys(preloadCache).forEach(key => {
    if (key.startsWith(charId)) {
      delete preloadCache[key]
    }
  })
  delete ongoingPreloads[charId]
  console.log(`[Preload] Cache cleared for ${charId}`)
}

/**
 * Get cache stats
 */
export const getCacheStats = (): { cacheSize: string; assetCount: number } => {
  let totalBytes = 0
  Object.values(preloadCache).forEach(entry => {
    totalBytes += entry.buffer.byteLength
  })
  return {
    cacheSize: `${(totalBytes / 1024 / 1024).toFixed(2)} MB`,
    assetCount: Object.keys(preloadCache).length
  }
}
