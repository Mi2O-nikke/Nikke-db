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
const getCacheKey = (charId: string, type: 'cover' | 'aim' | 'fb', extension: 'skel' | 'atlas' | 'png' | 'ogg', voiceFile?: string): string => {
  if (extension === 'ogg' && voiceFile) {
    return `${charId}_voice_${voiceFile}`
  }
  return `${charId}_${type}_${extension}`
}

/**
 * Fetch and cache a file with fallback support
 * If primary path fails, tries fallback path
 */
const fetchAndCacheWithFallback = async (primaryUrl: string, fallbackUrl: string | null, cacheKey: string): Promise<ArrayBuffer> => {
  // Check if already cached
  if (preloadCache[cacheKey]) {
    return preloadCache[cacheKey].buffer
  }

  try {
    // Try primary URL first
    const response = await fetch(primaryUrl)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    
    const buffer = await response.arrayBuffer()
    
    // Cache the result
    preloadCache[cacheKey] = {
      buffer,
      timestamp: Date.now()
    }
    return buffer
  } catch (error) {
    // Try fallback if available
    if (fallbackUrl) {
      try {
        const fallbackResponse = await fetch(fallbackUrl)
        if (!fallbackResponse.ok) {
          throw new Error(`HTTP ${fallbackResponse.status}`)
        }
        
        const buffer = await fallbackResponse.arrayBuffer()
        
        // Cache the result
        preloadCache[cacheKey] = {
          buffer,
          timestamp: Date.now()
        }
        return buffer
      } catch (fallbackError) {
        throw fallbackError
      }
    }
    throw error
  }
}

/**
 * Fetch and cache a file
 */
const fetchAndCache = async (url: string, cacheKey: string): Promise<ArrayBuffer> => {
  // Check if already cached
  if (preloadCache[cacheKey]) {
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
    return buffer
  } catch (error) {
    throw error
  }
}

/**
 * Detect how many action_* files exist for a character
 * Uses quick HEAD requests to find the highest numbered file
 * Stops after 1 missing file (no gaps expected)
 */
const detectActionCount = async (baseCharId: string): Promise<number> => {
  let maxCount = 0
  let consecutiveMisses = 0  // Track consecutive misses
  
  // Try up to 20 variations to find all files
  for (let i = 1; i <= 20; i++) {
    const fileName = `${baseCharId}_00_action_${i}.ogg`
    const fxPath = `/assets/l2d/${baseCharId}/voice/fx/${fileName}`
    
    try {
      // Use HEAD request for faster detection (no body needed)
      const response = await fetch(fxPath, { method: 'HEAD' })
      
      // 200 or 304 = file exists
      if (response.status === 200 || response.status === 304) {
        maxCount = i  // Track the highest number found
        consecutiveMisses = 0  // Reset miss counter
      } else {
        // 404 or other error = file doesn't exist
        consecutiveMisses++
        // Stop after 1 miss (no gaps)
        if (consecutiveMisses >= 1) {
          break
        }
      }
    } catch (e) {
      // Network error or timeout, stop looking
      break
    }
  }
  return maxCount
}

/**
 * Preload essential voice files for fullbody mode
 * 
 * Loads:
 * 1. Lobby_Touch_* (1, 2, 3) - always 3
 * 2. Lobby_Touch_Love_* (1, 2, 3) - always 3
 * 3. Action FX sounds (*_00_action_*) - auto-detected count
 * 
 * Voice folder priority:
 * - If character is in voiceGroupOverrides, use the base character's voice folder
 * - Otherwise, use the character's own voice folder
 */
const preloadFullbodyVoiceFiles = async (charId: string, voiceGroupOverrides?: any): Promise<void> => {
  let voiceCharId = charId  // Default to character's own voice folder
  
  const baseCharId = charId.split('_')[0]
  
  // Check if this character shares voice with base (using imported voiceGroupOverrides)
  if (voiceGroupOverrides && voiceGroupOverrides[baseCharId]?.includes(charId)) {
    voiceCharId = baseCharId
  }
  
  const voicePromises: Promise<void>[] = []

  // Category 1: Lobby Touch sounds - Always 3
  for (let i = 1; i <= 3; i++) {
    voicePromises.push(
      (async () => {
        const fileName = `${voiceCharId}_Lobby_Touch_${i}.ogg`
        const voicePath = `/assets/l2d/${voiceCharId}/voice/${fileName}`
        const cacheKey = getCacheKey(charId, 'fb', 'ogg', fileName)
        
        try {
          await fetchAndCache(voicePath, cacheKey)
        } catch (e) {
          // File doesn't exist, skip silently
        }
      })()
    )
  }

  // Category 2: Lobby Touch Love sounds - Always 3
  for (let i = 1; i <= 3; i++) {
    voicePromises.push(
      (async () => {
        const fileName = `${voiceCharId}_Lobby_Touch_Love_${i}.ogg`
        const voicePath = `/assets/l2d/${voiceCharId}/voice/${fileName}`
        const cacheKey = getCacheKey(charId, 'fb', 'ogg', fileName)
        
        try {
          await fetchAndCache(voicePath, cacheKey)
        } catch (e) {
          // File doesn't exist, skip silently
        }
      })()
    )
  }

  // Category 3: Action FX sounds - Auto-detect count
  const actionCount = await detectActionCount(voiceCharId)
  for (let i = 1; i <= actionCount; i++) {
    voicePromises.push(
      (async () => {
        const fileName = `${voiceCharId}_00_action_${i}.ogg`
        const fxPath = `/assets/l2d/${voiceCharId}/voice/fx/${fileName}`
        const cacheKey = getCacheKey(charId, 'fb', 'ogg', `action_${fileName}`)
        
        try {
          await fetchAndCache(fxPath, cacheKey)
        } catch (e) {
          // Action file doesn't exist, skip silently
        }
      })()
    )
  }

  await Promise.all(voicePromises)
}

/**
 * Detect how many reload_* files exist for a character
 * Uses quick HEAD requests to find the highest numbered file
 * Stops after 1 missing file (no gaps expected)
 */
const detectReloadCount = async (baseCharId: string): Promise<number> => {
  let maxCount = 0
  let consecutiveMisses = 0  // Track consecutive misses
  
  // Try up to 10 variations to find all files
  for (let i = 1; i <= 10; i++) {
    const fileName = `${baseCharId}_reload_${i}.ogg`
    const fxPath = `/assets/l2d/${baseCharId}/voice/fx/${fileName}`
    
    try {
      // Use HEAD request for faster detection (no body needed)
      const response = await fetch(fxPath, { method: 'HEAD' })
      
      // 200 or 304 = file exists
      if (response.status === 200 || response.status === 304) {
        maxCount = i  // Track the highest number found
        consecutiveMisses = 0  // Reset miss counter
      } else {
        // 404 or other error = file doesn't exist
        consecutiveMisses++
        // Stop after 1 miss (no gaps)
        if (consecutiveMisses >= 1) {
          break
        }
      }
    } catch (e) {
      // Network error or timeout, stop looking
      break
    }
  }
  return maxCount
}

/**
 * Preload essential voice files for cover mode
 * 
 * Different flags require different preloads:
 * - 'm' (ramping): fire, fire_echo, fire_loop, fire_spin + all reload_* files (detected)
 * - 's' (single): gaugeup only + fire, all reload_* files (detected)
 * - 'e': gaugeup_2, gaugeup_max + fire, all reload_* files (detected)
 * - 'r': gaugeup_1, gaugeup_max + fire, all reload_* files (detected)
 */
const preloadVoiceFiles = async (charId: string, audioMode: string = '', gaugeupFlag: string = '', repeatFlag: string = ''): Promise<void> => {
  const baseCharId = charId.split('_')[0] // For variant support (c090_02 -> c090)
  
  const voicePromises: Promise<void>[] = []

  // Determine fire files to load based on audioMode
  const firesToLoad = []
  if (audioMode === 'm') {
    // Ramping mode: load all fire variations
    firesToLoad.push('fire', 'fire_echo', 'fire_loop', 'fire_spin')
  } else {
    // Normal mode: load just fire
    firesToLoad.push('fire')
  }

  // Category 1: FX Files - Fire sounds
  for (const pattern of firesToLoad) {
    voicePromises.push(
      (async () => {
        const fileName = `${baseCharId}_${pattern}.ogg`
        const fxPath = `/assets/l2d/${baseCharId}/voice/fx/${fileName}`
        const cacheKey = getCacheKey(charId, 'cover', 'ogg', `fx_${fileName}`)
        
        try {
          await fetchAndCache(fxPath, cacheKey)
        } catch (e) {
          // FX file doesn't exist, skip silently
        }
      })()
    )
  }

  // Category 2: Reload FX sounds - Detect count dynamically
  const reloadCount = await detectReloadCount(baseCharId)
  for (let i = 1; i <= reloadCount; i++) {
    voicePromises.push(
      (async () => {
        const fileName = `${baseCharId}_reload_${i}.ogg`
        const fxPath = `/assets/l2d/${baseCharId}/voice/fx/${fileName}`
        const cacheKey = getCacheKey(charId, 'cover', 'ogg', `fx_${fileName}`)
        
        try {
          // Try to fetch with a HEAD request first to check if it exists
          const headResponse = await fetch(fxPath, { method: 'HEAD' })
          if (!headResponse.ok) {
            return
          }
          await fetchAndCache(fxPath, cacheKey)
        } catch (e) {
          // Reload FX file doesn't exist, skip silently
        }
      })()
    )
  }

  // Category 3: Main Voice Folder Files - Damage and Reload (always 1, 2, 3)
  const mainVoicePatterns = ['Reload', 'Damage']
  for (const pattern of mainVoicePatterns) {
    for (let i = 1; i <= 3; i++) {
      voicePromises.push(
        (async () => {
          const fileName = `${baseCharId}_${pattern}_${i}.ogg`
          const voicePath = `/assets/l2d/${baseCharId}/voice/${fileName}`
          const cacheKey = getCacheKey(charId, 'cover', 'ogg', fileName)
          
          try {
            await fetchAndCache(voicePath, cacheKey)
          } catch (e) {
            // File doesn't exist, skip silently
          }
        })()
      )
    }
  }

  // Category 4: Gaugeup Files - Conditional based on flags
  if (gaugeupFlag === 'r') {
    // 'r' flag: load gaugeup_1 and gaugeup_max (shared files, no character prefix)
    const gaugeupVariations = ['1', 'max']
    for (const variation of gaugeupVariations) {
      voicePromises.push(
        (async () => {
          const fileName = `gaugeup_${variation}.ogg`
          const voicePath = `/assets/l2d/${baseCharId}/voice/${fileName}`
          const cacheKey = getCacheKey(charId, 'cover', 'ogg', `gaugeup_${fileName}`)
          
          try {
            await fetchAndCache(voicePath, cacheKey)
          } catch (e) {
            // Gaugeup file doesn't exist, skip silently
          }
        })()
      )
    }
  } else if (gaugeupFlag === 'e') {
    // 'e' flag: load gaugeup_2 and gaugeup_max (shared files, no character prefix)
    const gaugeupVariations = ['2', 'max']
    for (const variation of gaugeupVariations) {
      voicePromises.push(
        (async () => {
          const fileName = `gaugeup_${variation}.ogg`
          const voicePath = `/assets/l2d/${baseCharId}/voice/${fileName}`
          const cacheKey = getCacheKey(charId, 'cover', 'ogg', `gaugeup_${fileName}`)
          
          try {
            await fetchAndCache(voicePath, cacheKey)
          } catch (e) {
            // Gaugeup file doesn't exist, skip silently
          }
        })()
      )
    }
  } else if (repeatFlag === 's') {
    // 's' flag: load gaugeup only (shared file, no character prefix)
    voicePromises.push(
      (async () => {
        const fileName = `gaugeup.ogg`
        const voicePath = `/assets/l2d/${baseCharId}/voice/${fileName}`
        const cacheKey = getCacheKey(charId, 'cover', 'ogg', `gaugeup_${fileName}`)
        
        try {
          await fetchAndCache(voicePath, cacheKey)
        } catch (e) {
          // Gaugeup file doesn't exist, skip silently
        }
      })()
    )
  }
  // 'm' flag: no gaugeup files

  await Promise.all(voicePromises)
}

/**
 * Preload fullbody mode assets (skeleton, texture, voice files)
 * **FULLBODY MODE ONLY** - Only triggered when user switches to fullbody pose
 * 
 * Fullbody skeletons are in root folder (not in /fb/ subfolder)
 * Base: c270_00.skel, c270_00.atlas, c270_00.png
 * Variant: c270_01_00.skel, c270_01_00.atlas, c270_01_00.png
 */
export const preloadFullbodyModeAssets = async (charId: string, includeVoice: boolean = true, voiceGroupOverrides?: any): Promise<void> => {
  console.log(`[preloadFullbodyModeAssets] Called with charId=${charId}, includeVoice=${includeVoice}`)
  
  // ALWAYS delete old promise - don't reuse them
  if (ongoingPreloads[charId]) {
    console.log(`[preloadFullbodyModeAssets] Deleting old promise for ${charId}`)
    delete ongoingPreloads[charId]
  }
  
  const preloadPromise = (async () => {
    try {
      console.log(`[preloadFullbodyModeAssets] Starting preload for ${charId}`)
      const startTime = performance.now()

      // Load fullbody skeleton + texture in parallel
      // Fullbody files are in root folder with _00 suffix
      const fbPromises = [
        fetchAndCache(
          `/assets/l2d/${charId}/${charId}_00.skel`,
          getCacheKey(charId, 'fb', 'skel')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/${charId}_00.atlas`,
          getCacheKey(charId, 'fb', 'atlas')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/${charId}_00.png`,
          getCacheKey(charId, 'fb', 'png')
        )
      ]

      // Wait for all fullbody files to load
      console.log(`[preloadFullbodyModeAssets] Waiting for skeleton files`)
      await Promise.all(fbPromises)

      const skelTime = performance.now() - startTime
      console.log(`[preloadFullbodyModeAssets] Skeleton files loaded in ${skelTime.toFixed(0)}ms`)

      // Preload voice files - WAIT for them to complete
      if (includeVoice) {
        console.log(`[preloadFullbodyModeAssets] Starting voice file preload for ${charId}`)
        await preloadFullbodyVoiceFiles(charId, voiceGroupOverrides)
        console.log(`[preloadFullbodyModeAssets] Voice files preload complete`)
      }

      const totalTime = performance.now() - startTime
      console.log(`[preloadFullbodyModeAssets] Total preload time: ${totalTime.toFixed(0)}ms`)
    } catch (error) {
      console.error(`[preloadFullbodyModeAssets] Error: ${error}`)
      throw error
    } finally {
      console.log(`[preloadFullbodyModeAssets] Clearing cache for ${charId}`)
      delete ongoingPreloads[charId]
    }
  })()

  ongoingPreloads[charId] = preloadPromise
  return preloadPromise
}

/**
 * Preload cover and aim skeletons + textures in parallel
 * **COVER MODE ONLY** - Only triggered when user switches to cover pose
 * Returns promise that resolves when all assets are cached
 * 
 * Note: PNG files use different naming than skel/atlas:
 * - Skel/Atlas: c270_01_aim_00.skel, c270_01_aim_00.atlas
 * - PNG: c270_aim_01.png (uses variant number, not _00)
 */
export const preloadCoverModeAssets = async (charId: string, includeVoice: boolean = true, charConfig?: any): Promise<void> => {
  
  const preloadPromise = (async () => {
    try {
      const startTime = performance.now()

      const baseCharId = charId.split('_')[0]
      const variantNum = charId.includes('_') ? charId.split('_')[1] : '00'  // e.g., '01' from 'c270_01'

      // Load cover and aim in parallel
      const skelPromises = [
        // Cover skeleton files (use charId with _00 suffix)
        fetchAndCache(
          `/assets/l2d/${charId}/cover/${charId}_cover_00.skel`,
          getCacheKey(charId, 'cover', 'skel')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/cover/${charId}_cover_00.atlas`,
          getCacheKey(charId, 'cover', 'atlas')
        ),
        // Cover PNG (use baseCharId with variant number)
        fetchAndCache(
          `/assets/l2d/${charId}/cover/${baseCharId}_cover_${variantNum}.png`,
          getCacheKey(charId, 'cover', 'png')
        ),
        
        // Aim skeleton files (use charId with _00 suffix)
        fetchAndCache(
          `/assets/l2d/${charId}/aim/${charId}_aim_00.skel`,
          getCacheKey(charId, 'aim', 'skel')
        ),
        fetchAndCache(
          `/assets/l2d/${charId}/aim/${charId}_aim_00.atlas`,
          getCacheKey(charId, 'aim', 'atlas')
        ),
        // Aim PNG (use baseCharId with variant number)
        fetchAndCache(
          `/assets/l2d/${charId}/aim/${baseCharId}_aim_${variantNum}.png`,
          getCacheKey(charId, 'aim', 'png')
        )
      ]

      // Wait for all skeletons to load
      await Promise.all(skelPromises)

      const skelTime = performance.now() - startTime

      // Optionally preload voice files in background (non-blocking)
      if (includeVoice) {
        // Extract flags from character config
        const audioMode = charConfig?.timing?.audioMode || ''  // 'm' for ramping
        const gaugeupFlag = charConfig?.timing?.gaugeupFlag || ''  // 'r' or 'e'
        const repeatFlag = charConfig?.timing?.repeatFlag || ''  // 's', 'r', 'e', 'm'
        
        preloadVoiceFiles(charId, audioMode, gaugeupFlag, repeatFlag).catch(e => {
        })
      }

      const totalTime = performance.now() - startTime
    } catch (error) {
      throw error
    }
  })()

  ongoingPreloads[charId] = preloadPromise
  return preloadPromise
}

/**
 * Detect count of Ult_Skill voice files (e.g., Ult_Skill_1, Ult_Skill_2...)
 * Most characters only have 1, some rare ones might have 2-3
 * Stops at first missing file
 */
const detectUltSkillCount = async (charId: string): Promise<number> => {
  let maxCount = 1  // Always at least 1
  
  // Only check for 2nd file, if not found, just use 1
  const testUrl = `/assets/l2d/${charId}/voice/${charId}_Ult_Skill_2.ogg`
  try {
    const response = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
    if (response.status === 200 || response.status === 304) {
      maxCount = 2
    }
  } catch {
    // File doesn't exist, use 1
  }
  return maxCount
}

/**
 * Preload skillcut mode assets for a character
 * Handles variant fallback: if variant doesn't have skillcut spine, use base character's
 * Voice files: Ult_Skill_N and ult_cutscene (always ogg, not mp3)
 */
export const preloadSkillcutModeAssets = async (charId: string, includeVoice: boolean = true): Promise<void> => {
  // ALWAYS delete old promise - don't reuse them
  if (ongoingPreloads[charId]) {
    delete ongoingPreloads[charId]
  }

  const preloadPromise = (async () => {
    try {

      // Extract variant and base character
      const match = charId.match(/^(c\d+)(?:_(\d+))?$/)
      if (!match) {
        return
      }
      const baseCharId = match[1]
      const variantNum = match[2]

      // Determine which character ID to use for spine files (skeleton, atlas, png)
      // Try variant first, fallback to base
      let spineCharId = charId
      let useVariantSpine = true

      if (variantNum) {
        // For variants, we need to check if the skillcut spine files exist
        // Pattern: c511_01_skillcut.skel exists for c511_01
        // But if c511_02 doesn't have skillcut spine, fallback to c511_00
        const testUrl = `/assets/l2d/${charId}/${charId}_00_skillcut.skel`
        try {
          const response = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
          if (!response.ok) {
            // Variant doesn't have its own skillcut spine, use base
            spineCharId = `${baseCharId}_00`
            useVariantSpine = false
          }
        } catch (e) {
          console.log(`[preloadSkillcutModeAssets] Variant check failed for ${charId}, using base`)
          spineCharId = `${baseCharId}_00`
          useVariantSpine = false
        }
      } else {
        // Base character - use _00 suffix
        spineCharId = `${baseCharId}_00`
      }

      // Load skeleton, atlas, and PNG in parallel
      const skelUrl = `/assets/l2d/${spineCharId}/${spineCharId}_skillcut.skel`
      const atlasUrl = `/assets/l2d/${spineCharId}/${spineCharId}_skillcut.atlas`
      const pngUrl = `/assets/images/sprite/${spineCharId}_skillcut.png`

      const promises = [
        fetchAndCache(skelUrl, getCacheKey(charId, 'fb', 'skel')),
        fetchAndCache(atlasUrl, getCacheKey(charId, 'fb', 'atlas')),
        fetchAndCache(pngUrl, getCacheKey(charId, 'fb', 'png'))
      ]

      // Preload voice files if requested
      if (includeVoice) {
        // Determine voice character ID
        // If variant has its own Ult_Skill voice, use variant's voice
        // Otherwise use base character's voice
        let voiceCharId = charId
        
        if (variantNum) {
          // Check if variant has its own Ult_Skill_1 voice
          const variantVoiceUrl = `/assets/l2d/${charId}/voice/${charId}_Ult_Skill_1.ogg`
          try {
            const response = await fetch(variantVoiceUrl, { method: 'HEAD', signal: AbortSignal.timeout(2000) })
            if (!response.ok) {
              voiceCharId = baseCharId
            }
          } catch (e) {
            voiceCharId = baseCharId
          }
        }

        // Just try to fetch Ult_Skill_1 and ult_cutscene, don't overthink it
        
        promises.push(
          fetchAndCache(`/assets/l2d/${voiceCharId}/voice/${voiceCharId}_Ult_Skill_1.ogg`, getCacheKey(charId, 'fb', 'ogg', `Ult_Skill_1`)).catch((e) => {
            // Voice file doesn't exist, skip silently
            return Promise.resolve()
          })
        )
        
        // ult_cutscene is in the fx folder
        promises.push(
          fetchAndCache(`/assets/l2d/${voiceCharId}/voice/fx/${voiceCharId}_ult_cutscene.ogg`, getCacheKey(charId, 'fb', 'ogg', 'ult_cutscene')).catch((e) => {
            // ult_cutscene doesn't exist, skip silently
            return Promise.resolve()
          })
        )
      }

      await Promise.all(promises)
    } catch (error) {
      throw error
    } finally {
      // Clear the ongoing preload flag when done
      delete ongoingPreloads[charId]
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
