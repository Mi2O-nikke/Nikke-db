<template>
  <div id="player-container" :class="[checkMobile() ? 'mobile' : 'computer', { 'spine-hidden': isSpineHidden }]"></div>
</template>

<script setup lang="ts">
import { onMounted, watch, ref } from 'vue'
import { useMarket } from '@/stores/market'

// @ts-ignore
import spine40 from '@/utils/spine/spine-player4.0'
// @ts-ignore
import spine41 from '@/utils/spine/spine-player4.1'

import { globalParams, messagesEnum } from '@/utils/enum/globalParams'
import type { AttachmentInterface, AttachmentItemColorInterface } from '@/utils/interfaces/live2d'
import { specialClickAnimations } from '@/utils/json/l2d'

let canvas: HTMLCanvasElement | null = null
let spineCanvas: any = null
const market = useMarket()

// Track spine visibility - hide until position is applied (reactive)
const isSpineHidden = ref(true)

// Track alternating animations per character
const animationIndex: { [key: string]: number } = {}

// Track default zoom per character to detect manual zoom adjustments
let lastCharacterId = ''
let hasUserZoomed = false
let defaultZoomForCharacter = 0.5

// Track both aim and cover spines
let aimSpinePlayer: any = null
let coverSpinePlayer: any = null
let currentActiveSpine: 'aim' | 'cover' | null = null

// Multi-skeleton support for c515
interface OverlayInstance {
  skeleton: any
  state: any
  segments: any[]
  source: string
}
let overlayInstances: OverlayInstance[] = []
let usedSpine: any = null

// BGM tracking
let currentBGM: HTMLAudioElement | null = null

// Track skillcut overlay sound separately so it can be stopped
let currentSkillcutOverlaySound: HTMLAudioElement | null = null

// Configuration for characters with non-standard skillcut default animations
const skillcutAnimationOverrides: { [key: string]: string } = {
  'c513_03': 'idle_all',
  // Add more characters here as needed
}

// Configuration for characters with non-standard idle animations to use after skillcut
const skillcutIdleAnimationOverrides: { [key: string]: string } = {
  'c513_03': 'idle_all',
  // Add more characters here as needed
}

// Extend window for storing Spine library
declare global {
  interface Window {
    usedSpineGlobal?: any
  }
}

// http://esotericsoftware.com/spine-player#Viewports
const spineViewport = {
  padLeft: '20%',
  padRight: '20%',
  padTop: '20%',
  padBottom: '20%'
}

const spineScale = 1.2

onMounted(() => {
  market.load.beginLoad()
  spineLoader()
  setupClickListener()
})

const setupClickListener = () => {
  const container = document.getElementById('player-container')
  if (container) {
    container.addEventListener('mousedown', handleActionStart)
    container.addEventListener('mouseup', handleActionEnd)
    container.addEventListener('mouseleave', handleActionEnd)
  }
}

const handleActionStart = () => {

  if (!spinePlayer) return
  
  // For cover pose - just play cover_reload then back to cover_idle
  if (market.live2d.current_pose === 'cover') {
    // Check if cover_reload animation exists
    const animations = spinePlayer.animationState.data.skeletonData.animations
    const hasCoverReload = animations.some((a: { name: string }) => a.name === 'cover_reload')
    
    if (!hasCoverReload) {
      // Fallback to action if cover_reload doesn't exist
      handleAction()
      return
    }
    
    spinePlayer.animationState.setAnimation(0, 'cover_reload', false)
    spinePlayer.animationState.addAnimation(0, 'cover_idle', true, 0)
    playVoice()
    return
  }
  
  // Special handling for aim pose - hold to keep playing aim_hit
  if (market.live2d.current_pose === 'aim') {
    // Check if aim_hit animation exists
    const animations = spinePlayer.animationState.data.skeletonData.animations
    const hasAimHit = animations.some((a: { name: string }) => a.name === 'aim_hit')
    
    if (!hasAimHit) {
      // Fallback to action if aim_hit doesn't exist
      handleAction()
      return
    }
    
    isAimHolding = true
    spinePlayer.animationState.setAnimation(0, 'aim_hit', true) // true = loop
    return
  }

  // Skillcut pose - play skillcut animation
  if (market.live2d.current_pose === 'skillcut') {
    // Check if skillcut animation exists
    const animations = spinePlayer.animationState.data.skeletonData.animations
    let skillcutAnimation = 'skillcut_all'
    
    // Try skillcut_all first
    let hasSkillcut = animations.some((a: { name: string }) => a.name === 'skillcut_all')
    
    // Fallback to skillcut_0 if skillcut_all doesn't exist
    if (!hasSkillcut) {
      skillcutAnimation = 'skillcut_0'
      hasSkillcut = animations.some((a: { name: string }) => a.name === 'skillcut_0')
    }
    
    // Fallback to skillcut_1 if skillcut_0 doesn't exist
    if (!hasSkillcut) {
      skillcutAnimation = 'skillcut_1'
      hasSkillcut = animations.some((a: { name: string }) => a.name === 'skillcut_1')
    }
    
    // Fallback to skill_cut if neither exists
    if (!hasSkillcut) {
      skillcutAnimation = 'skill_cut'
      hasSkillcut = animations.some((a: { name: string }) => a.name === 'skill_cut')
    }
    
    if (!hasSkillcut) {
      // Fallback to action if none of the skillcut animations exist
      handleAction()
      return
    }
    
    // Determine what idle animation to use after skillcut
    let idleAnimation = 'idle'
    if (skillcutIdleAnimationOverrides[market.live2d.current_id]) {
      idleAnimation = skillcutIdleAnimationOverrides[market.live2d.current_id]
    }
    
    // Play the skillcut animation then loop back to idle
    spinePlayer.animationState.setAnimation(0, skillcutAnimation, false)
    spinePlayer.animationState.addAnimation(0, idleAnimation, true, 0)
    playVoice()
    return
  }
  
  handleAction()
}

const swapToAimSpine = async () => {
  if (!spineCanvas) return
  
  try {
    // Load aim spine data
    const aimData = await loadSpineData('aim')
    const uintArray = new Uint8Array(aimData.buffer)
    const versionBytes = uintArray.slice(0, 16)
    const versionString = new TextDecoder().decode(versionBytes).replace(/\0/g, '')

    let usedSpine
    if (/4\.0\.\d+/.test(versionString)) {
      usedSpine = spine40
    } else if (/4\.1\.\d+/.test(versionString)) {
      usedSpine = spine41
    } else {
      usedSpine = spine41
    }

    // Create temporary aim player
    const tempAimPlayer = new usedSpine.SpinePlayer('player-container', {
      skelUrl: market.live2d.current_id + '_aim',
      rawDataURIs: {
        [market.live2d.current_id + '_aim']: aimData.skelURL
      },
      atlasUrl: getPathing('atlas', 'aim'),
      animation: 'aim_hit',
      skin: 'default',
      backgroundColor: '#00000000',
      alpha: true,
      premultipliedAlpha: true,
      mipmaps: false,
      debug: false,
      preserveDrawingBuffer: true,
      viewport: spineViewport,
      scale: spineScale,
      defaultMix: SPINE_DEFAULT_MIX,
      success: (player: any) => {
        spinePlayer = player
        playVoice()
        
        // After aim_hit animation, swap back to cover
        setTimeout(() => {
          swapBackToCoverSpine()
        }, 1500) // Adjust timing based on aim_hit duration
      },
      error: () => {
        console.error('Failed to load aim spine')
        // Fallback: just play action on current spine
        handleAction()
      }
    })
  } catch (error) {
    console.warn('Aim spine not available:', error)
    // Fallback: just play action on current spine
    handleAction()
  }
}

const swapBackToCoverSpine = async () => {
  if (!spineCanvas) return
  
  try {
    // Reload cover spine
    const coverData = await loadSpineData('cover')
    const uintArray = new Uint8Array(coverData.buffer)
    const versionBytes = uintArray.slice(0, 16)
    const versionString = new TextDecoder().decode(versionBytes).replace(/\0/g, '')

    let usedSpine
    if (/4\.0\.\d+/.test(versionString)) {
      usedSpine = spine40
    } else if (/4\.1\.\d+/.test(versionString)) {
      usedSpine = spine41
    } else {
      usedSpine = spine41
    }

    // Create temporary cover player
    const tempCoverPlayer = new usedSpine.SpinePlayer('player-container', {
      skelUrl: market.live2d.current_id + '_cover',
      rawDataURIs: {
        [market.live2d.current_id + '_cover']: coverData.skelURL
      },
      atlasUrl: getPathing('atlas', 'cover'),
      animation: 'cover_reload',
      skin: 'default',
      backgroundColor: '#00000000',
      alpha: true,
      premultipliedAlpha: true,
      mipmaps: false,
      debug: false,
      preserveDrawingBuffer: true,
      viewport: spineViewport,
      scale: spineScale,
      defaultMix: SPINE_DEFAULT_MIX,
      success: (player: any) => {
        spinePlayer = player
        // Queue cover_idle after cover_reload
        spinePlayer.animationState.addAnimation(0, 'cover_idle', true, 0)
      },
      error: () => {
        console.error('Failed to load cover spine')
        // Fallback: reload the fullbody spine
        loadSpineAfterWatcher()
      }
    })
  } catch (error) {
    console.warn('Cover spine not available:', error)
    // Fallback: reload the fullbody spine
    loadSpineAfterWatcher()
  }
}

const playVoiceWithRetry = (characterId: string, pose: string, attemptCount = 0): boolean => {
  const MAX_VOICE_RECURSION = 25 // Max recursion depth
  
  if (attemptCount > MAX_VOICE_RECURSION) {
    console.warn(`Max voice recursion depth reached for ${characterId}`)
    return false
  }

  // Get voice folder ID (handles group overrides)
  let voiceFolderId = characterId
  for (const [baseId, variants] of Object.entries(voiceGroupOverrides)) {
    if (Array.isArray(variants) && variants.includes(characterId)) {
      voiceFolderId = baseId
      break
    }
  }

  const voices = voiceMap[voiceFolderId]?.[pose]
  
  if (!voices || voices.length === 0) return false
  
  const voiceKey = `${voiceFolderId}_${pose}`
  let currentIndex = voiceIndexMap.get(voiceKey) ?? 0
  const voice = voices[currentIndex]
  
  // Check cache first - skip known missing voices
  if (voiceExistsCache.has(voice) && voiceExistsCache.get(voice) === false) {
    console.debug(`Skipping known missing voice: ${voice}`)
    // Move to next voice and try again
    currentIndex = (currentIndex + 1) % voices.length
    voiceIndexMap.set(voiceKey, currentIndex)
    return playVoiceWithRetry(characterId, pose, attemptCount + 1)
  }
  
  // Increment index for next time
  currentIndex = (currentIndex + 1) % voices.length
  voiceIndexMap.set(voiceKey, currentIndex)
  
  if (currentVoice) {
    currentVoice.pause()
    currentVoice.currentTime = 0
  }

  // Try to play this voice
  if (voice) {
    currentVoice = new Audio(voice)
    currentVoice.addEventListener('error', () => {
      voiceExistsCache.set(voice, false)
      console.debug(`Voice file not found: ${voice}`)
      // On error, try the next voice
      playVoiceWithRetry(characterId, pose, attemptCount + 1)
    }, { once: true })
    
    currentVoice.addEventListener('canplay', () => {
      voiceExistsCache.set(voice, true)
    }, { once: true })
    
    currentVoice.play().catch((err) => {
      console.debug(`Failed to play voice: ${err.message}`)
    })
    
    return true
  }
  
  return false
}

const playVoice = () => {
  const characterData = l2dData.find((a) => a.id === market.live2d.current_id)
  if (!characterData) return
  
  // Stop any existing sound effects first
  stopAllSoundEffects()
  
  // In skillcut mode, use specialized skillcut sound handler (handles all audio)
  if (market.live2d.current_pose === 'skillcut') {
    playSkillcutSound()
    return
  }
  
  let currentPose = 'normal'
  if (market.live2d.current_pose === 'cover') {
    currentPose = 'cover'
  }
  
  // Try to play voice with automatic retry on missing files
  playVoiceWithRetry(market.live2d.current_id, currentPose)
  
  // In cover mode, also play reload sound simultaneously
  if (market.live2d.current_pose === 'cover') {
    playReloadSound()
  }
  
  // In fullbody mode, also play action sound simultaneously
  if (market.live2d.current_pose === 'fb') {
    playActionSound()
  }
}

const stopAllSoundEffects = () => {
  // Stop reload sound
  if (currentReloadSound) {
    currentReloadSound.pause()
    currentReloadSound.currentTime = 0
    currentReloadSound = null
  }
  
  // Stop action sound
  if (currentActionSound) {
    currentActionSound.pause()
    currentActionSound.currentTime = 0
    currentActionSound = null
  }
  
  // Stop skillcut overlay sound
  if (currentSkillcutOverlaySound) {
    currentSkillcutOverlaySound.pause()
    currentSkillcutOverlaySound.currentTime = 0
    currentSkillcutOverlaySound = null
  }
  
  // Reset action sound sequence
  actionSoundIndex = 1
  
  // Reset reload sound sequence
  reloadSoundIndex = 1
}

const playReloadSound = () => {
  // Get base character ID for reload sound (always stored in base folder)
  // e.g., 'c271_01' -> 'c271'
  const baseCharacterId = market.live2d.current_id.split('_')[0]
  
  // Reset to start of sequence when new reload sound starts
  reloadSoundIndex = 1
  playNextReloadSound(baseCharacterId)
}

const playNextReloadSound = (baseCharacterId: string) => {
  // Check if we've reached the end of the sequence (1-4)
  if (reloadSoundIndex > 4) {
    return
  }
  
  // Construct reload sound path
  const reloadSoundPath = `/assets/voice/${baseCharacterId}/fx/${baseCharacterId}_reload_${reloadSoundIndex}.ogg`
  
  // Get config for this character and reload number
  const characterConfig = reloadSoundConfig[baseCharacterId]
  const soundConfig = characterConfig?.[reloadSoundIndex] || {}
  
  let eventHandled = false
  
  const moveToNext = () => {
    if (!eventHandled) {
      eventHandled = true
      reloadSoundIndex++
      setTimeout(() => playNextReloadSound(baseCharacterId), 50)
    }
  }
  
  const tryPlayReload = (soundPath: string) => {
    // Check if file exists first (HEAD request, no logging)
    fetch(soundPath, { method: 'HEAD' }).then((response) => {
      if (!response.ok) {
        // File doesn't exist, skip to next
        moveToNext()
        return
      }
      
      // File exists, proceed with playback
      currentReloadSound = new Audio(soundPath)
      
      // Set up trim if configured
      if (soundConfig.trimMs) {
        currentReloadSound.addEventListener('canplay', () => {
          setTimeout(() => {
            if (currentReloadSound && currentReloadSound.currentTime >= 0) {
              currentReloadSound.pause()
              moveToNext()
            }
          }, soundConfig.trimMs)
        }, { once: true })
      }
      
      currentReloadSound.addEventListener('error', () => {
        moveToNext()
      }, { once: true })
      
      // Set a timeout in case it fails to load
      const timeoutId = setTimeout(() => {
        moveToNext()
      }, 2000)
      
      // Handle overlap - wait for metadata to get duration
      if (soundConfig.overlapMs || soundConfig.overlap) {
        currentReloadSound.addEventListener('loadedmetadata', () => {
          const durationMs = currentReloadSound.duration * 1000
          let overlapStart
          
          if (soundConfig.overlap !== undefined) {
            // Calculate overlap based on percentage (0-10 scale, where 10 = 100%)
            const percentageDecimal = soundConfig.overlap / 10
            overlapStart = Math.max(0, durationMs * percentageDecimal)
          } else {
            // Use milliseconds if overlapMs is specified
            overlapStart = Math.max(0, durationMs - soundConfig.overlapMs)
          }
          
          // Start next sound during this one (don't wait for 'ended')
          setTimeout(() => {
            if (!eventHandled) {
              reloadSoundIndex++
              playNextReloadSound(baseCharacterId)
            }
          }, overlapStart)
        }, { once: true })
      } else {
        // Only add 'ended' listener if NOT using overlap
        currentReloadSound.addEventListener('ended', () => {
          moveToNext()
        }, { once: true })
      }
      
      // Play with delay if configured
      const playWithDelay = () => {
        currentReloadSound.play().then(() => {
          clearTimeout(timeoutId)
        }).catch(() => {
          clearTimeout(timeoutId)
          moveToNext()
        })
      }
      
      if (soundConfig.delay) {
        setTimeout(playWithDelay, soundConfig.delay)
      } else {
        playWithDelay()
      }
    }).catch(() => {
      // Network error, skip to next
      moveToNext()
    })
  }
  
  // Start with primary path
  tryPlayReload(reloadSoundPath)
}

const playActionSound = () => {
  // Favorite characters don't have action sounds
  if (market.live2d.current_id.includes('favorite')) {
    return
  }
  
  // Reset to start of sequence when new action sound starts
  actionSoundIndex = 1
  playNextActionSound()
}

const playNextActionSound = (pathAttempt = 0) => {
  // Get config for this character and action number
  const characterConfig = actionSoundConfig[market.live2d.current_id]
  const soundConfig = characterConfig?.[actionSoundIndex] || {}
  
  // Store max actions per character to avoid repeated 404s
  if (!window.actionMaxCache) window.actionMaxCache = {}
  const charId = market.live2d.current_id
  const cachedMax = window.actionMaxCache[charId]
  
  // If we already know the max for this character, stop before requesting
  if (cachedMax && actionSoundIndex > cachedMax) {
    return
  }
  
  // Construct action sound paths - try original first, then _00 version
  const baseCharacterId = market.live2d.current_id.split('_')[0]
  const isVariant = baseCharacterId !== market.live2d.current_id
  
  // For base characters, try original first, then _00 version
  // For variants, just use as-is
  const soundPaths = []
  soundPaths.push(`/assets/voice/${market.live2d.current_id}/fx/${market.live2d.current_id}_action_${actionSoundIndex}.ogg`)
  if (!isVariant) {
    soundPaths.push(`/assets/voice/${market.live2d.current_id}/fx/${market.live2d.current_id}_00_action_${actionSoundIndex}.ogg`)
  }
  
  if (pathAttempt >= soundPaths.length) {
    // All paths failed, cache the max
    if (!window.actionMaxCache[charId]) {
      window.actionMaxCache[charId] = actionSoundIndex - 1
    }
    return
  }
  
  const actionSoundPath = soundPaths[pathAttempt]
  
  // Try to play action sound
  currentActionSound = new Audio(actionSoundPath)
  
  let eventHandled = false
  
  const moveToNext = () => {
    if (!eventHandled) {
      eventHandled = true
      actionSoundIndex++
      setTimeout(() => playNextActionSound(), 50)
    }
  }
  
  // Set up trim if configured
  if (soundConfig.trimMs) {
    currentActionSound.addEventListener('canplay', () => {
      setTimeout(() => {
        if (currentActionSound && currentActionSound.currentTime >= 0) {
          currentActionSound.pause()
          moveToNext()
        }
      }, soundConfig.trimMs)
    }, { once: true })
  }
  
  // Handle overlap - wait for metadata to get duration
  if (soundConfig.overlapMs || soundConfig.overlap) {
    currentActionSound.addEventListener('loadedmetadata', () => {
      const durationMs = currentActionSound.duration * 1000
      let overlapStart
      
      if (soundConfig.overlap !== undefined) {
        // Calculate overlap based on percentage (0-10 scale, where 10 = 100%)
        const percentageDecimal = soundConfig.overlap / 10
        overlapStart = Math.max(0, durationMs * percentageDecimal)
      } else {
        // Use milliseconds if overlapMs is specified
        overlapStart = Math.max(0, durationMs - soundConfig.overlapMs)
      }
      
      // Start next sound during this one (don't wait for 'ended')
      setTimeout(() => {
        if (!eventHandled) {
          actionSoundIndex++
          playNextActionSound()
        }
      }, overlapStart)
    }, { once: true })
  } else {
    // Only add 'ended' listener if NOT using overlap
    currentActionSound.addEventListener('ended', () => {
      moveToNext()
    }, { once: true })
  }
  
  currentActionSound.addEventListener('error', () => {
    // Try next path
    playNextActionSound(pathAttempt + 1)
  }, { once: true })
  
  // Play with delay if configured
  const playWithDelay = () => {
    currentActionSound.play().catch((error) => {
      return
    })
  }
  
  if (soundConfig.delay) {
    // Auto multiply by 100 to convert to milliseconds (e.g., 3 -> 300ms)
    setTimeout(playWithDelay, soundConfig.delay * 100)
  } else {
    playWithDelay()
  }
}

const playSkillcutSound = () => {
  // Stop any existing skillcut sounds first
  if (currentActionSound) {
    currentActionSound.pause()
    currentActionSound = null
  }
  if (currentSkillcutOverlaySound) {
    currentSkillcutOverlaySound.pause()
    currentSkillcutOverlaySound = null
  }

  const characterId = market.live2d.current_id
  
  // Determine voice folder ID (handles group overrides for fallback)
  let voiceFolderId = characterId
  for (const [baseId, variants] of Object.entries(voiceGroupOverrides)) {
    if (Array.isArray(variants) && variants.includes(characterId)) {
      voiceFolderId = baseId
      break
    }
  }
  
  // Play main sound (Ult_Skill_1)
  let mainPath = `/assets/voice/${voiceFolderId}/${voiceFolderId}_Ult_Skill_1.ogg`
  
  console.debug(`Playing skillcut main sound: ${mainPath}`)
  currentActionSound = new Audio(mainPath)
  currentActionSound.play().catch(() => {
    console.debug(`Failed to play main skillcut sound: ${mainPath}`)
  })
  
  // Play overlay sound (ult_cutscene)
  let overlayPath = `/assets/voice/${voiceFolderId}/fx/${voiceFolderId}_ult_cutscene.ogg`
  
  console.debug(`Playing skillcut overlay sound: ${overlayPath}`)
  currentSkillcutOverlaySound = new Audio(overlayPath)
  currentSkillcutOverlaySound.play().catch(() => {
    console.debug(`Failed to play overlay skillcut sound: ${overlayPath}`)
  })
}

const handleActionEnd = () => {
  if (!spinePlayer) return
  
  // Release aim_hit animation when mouse is released
  if (isAimHolding && market.live2d.current_pose === 'aim') {
    isAimHolding = false
    spinePlayer.animationState.setAnimation(0, 'aim_idle', true)
  }
}

const SPINE_DEFAULT_MIX = 0.25
let spinePlayer: any = null

// Auto-detect and load overlay skeletons (bg and fg layers) for any character
function loadOverlaySkeletons() {
  if (!spineCanvas?.context) {
    overlayInstances = []
    return Promise.resolve()
  }

  return new Promise<void>(async (resolve) => {
    try {
      const SpineLib = (window as any).usedSpineGlobal
      
      if (!SpineLib) {
        resolve()
        return
      }

      overlayInstances = []
      const characterId = market.live2d.current_id
      const charFolder = `assets/l2d/${characterId}`

      // Characters known to have fg/bg overlays (most don't)
      const charWithOverlays = ['c513_03', 'c515']
      if (!charWithOverlays.includes(characterId)) {
        resolve()
        return
      }

      // Determine the suffix pattern from main skeleton
      // First, try to find what suffix the main skeleton uses by checking common patterns
      let mainSuffix = '_00'
      const suffixPatterns = ['_00', '_02', '_04', '_01', '_03', '_05']
      
      for (const suffix of suffixPatterns) {
        try {
          const mainCheckResponse = await fetch(`${charFolder}/${characterId}${suffix}.skel`, { method: 'HEAD' })
          if (mainCheckResponse.ok) {
            mainSuffix = suffix
            break
          }
        } catch (error) {
          continue
        }
      }

      // Helper function to load overlay with detected suffix
      const tryLoadOverlay = async (overlayType: 'bg' | 'fg'): Promise<boolean> => {
        // Determine suffix for overlays based on character ID pattern
        // Characters with _01, _02, etc don't have _00 suffix for overlays
        // Characters without variant suffix use _00 for overlays
        const hasVariant = /_\d{2}$/.test(characterId)
        const overlaySuffix = hasVariant ? '' : mainSuffix
        
        // Try with the appropriate suffix
        const pathPatterns = [
          { skel: `${charFolder}/${characterId}${overlaySuffix}_${overlayType}.skel`, atlas: `${charFolder}/${characterId}${overlaySuffix}_${overlayType}.atlas` },
          { skel: `${charFolder}/${characterId}_${overlayType}.skel`, atlas: `${charFolder}/${characterId}_${overlayType}.atlas` }
        ]

        for (const paths of pathPatterns) {
          try {
            const checkResponse = await fetch(paths.skel, { method: 'HEAD' }).catch(() => ({ ok: false }))
            if (checkResponse.ok) {
              const assetMgr = new SpineLib.AssetManager(spineCanvas.context, '')
              assetMgr.loadBinary(paths.skel)
              assetMgr.loadTextureAtlas(paths.atlas)
              await assetMgr.loadAll()
              
              const binary = assetMgr.require(paths.skel)
              const atlas = assetMgr.require(paths.atlas)
              const skeletonBinary = new SpineLib.SkeletonBinary(new SpineLib.AtlasAttachmentLoader(atlas))
              const skeletonData = skeletonBinary.readSkeletonData(binary)
              
              const animations = skeletonData.animations.map((a: any) => a.name)
              
              const skeleton = new SpineLib.Skeleton(skeletonData)
              skeleton.scaleX = spineCanvas.skeleton.scaleX
              skeleton.scaleY = spineCanvas.skeleton.scaleY
              skeleton.x = spineCanvas.skeleton.x
              skeleton.y = spineCanvas.skeleton.y
              
              const state = new SpineLib.AnimationState(new SpineLib.AnimationStateData(skeletonData))
              
              // Try common idle animation names
              let defaultAnim = 'idle'
              if (overlayType === 'bg' && animations.includes('bg_idle')) {
                defaultAnim = 'bg_idle'
              } else if (overlayType === 'fg' && animations.includes('fg_idle')) {
                defaultAnim = 'fg_idle'
              } else if (animations.includes('bg_idle')) {
                defaultAnim = 'bg_idle'
              } else if (animations.length > 0) {
                defaultAnim = animations[0]
              }
              
              state.setAnimation(0, defaultAnim, true)

              overlayInstances.push({
                skeleton: skeleton,
                state: state,
                segments: [],
                source: `${characterId}_${overlayType}`
              })
              
              return true
            }
          } catch (error) {
            continue
          }
        }
        
        return false
      }

      // Try to load background
      await tryLoadOverlay('bg')
      
      // Try to load foreground
      await tryLoadOverlay('fg')

      resolve()
    } catch (error) {
      overlayInstances = []
      resolve()
    }
  })
}

// Render function that includes overlays
function renderWithOverlays() {
  if (!spineCanvas?.sceneRenderer) return

  const renderer = spineCanvas.sceneRenderer

  // Update overlay animations
  overlayInstances.forEach(overlay => {
    overlay.state.update(1 / 60)
    overlay.state.apply(overlay.skeleton)
    overlay.skeleton.updateWorldTransform()
  })

  // Render main skeleton
  renderer.begin()
  renderer.drawSkeleton(spineCanvas.skeleton, true)

  // Render overlays (bg first, then fg)
  overlayInstances.forEach(overlay => {
    renderer.drawSkeleton(overlay.skeleton, true)
  })

  renderer.end()
}

// Load spine data for a specific pose
const loadSpineData = (pose: 'aim' | 'cover'): Promise<any> => {
  return new Promise((resolve, reject) => {
    const skelUrl = getPathing('skel', pose)
    const request = new XMLHttpRequest()

    request.responseType = 'arraybuffer'
    request.open('GET', skelUrl, true)
    request.timeout = 5000 // 5 second timeout
    
    request.onload = () => {
      if (request.status === 404) {
        console.warn(`${pose} skel file not found for ${market.live2d.current_id}`)
        reject(new Error(`${pose} pose not available`))
        return
      }
      
      if (request.status !== 200) {
        console.error(`Failed to load ${pose} skel file:`, request.statusText)
        reject(new Error(`Failed to load ${pose} skel`))
        return
      }

      const buffer = request.response
      const frURL = new FileReader()
      frURL.readAsArrayURL(new Blob([buffer]))
      frURL.onload = () => {
        resolve({
          skelURL: frURL.result,
          buffer: buffer
        })
      }
      frURL.onerror = () => {
        reject(new Error(`Failed to read ${pose} skel file`))
      }
    }
    
    request.onerror = () => {
      reject(new Error(`Network error loading ${pose} skel`))
    }
    
    request.ontimeout = () => {
      reject(new Error(`Timeout loading ${pose} skel`))
    }
    
    request.send()
  })
}

const spineLoader = () => {
  let skelUrl = getPathing('skel')
  const request = new XMLHttpRequest()

  request.responseType = 'arraybuffer'
  request.open('GET', skelUrl, true)
  request.send()
  request.onloadend = () => {
    // If skillcut file not found, try base character's skillcut
    if (request.status !== 200 && market.live2d.current_pose === 'skillcut') {
      const characterId = market.live2d.current_id
      const baseCharacterId = characterId.split('_')[0]
      
      if (baseCharacterId !== characterId) {
        console.warn(`Skillcut not found for ${characterId}, trying base character ${baseCharacterId}`)
        const baseSkelUrl = globalParams.PATH_L2D + baseCharacterId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharacterId + '_00_skillcut.skel'
        
        const baseRequest = new XMLHttpRequest()
        baseRequest.responseType = 'arraybuffer'
        baseRequest.open('GET', baseSkelUrl, true)
        baseRequest.send()
        baseRequest.onerror = () => {
          console.error('Failed to load base character skillcut: network error')
        }
        baseRequest.onloadend = () => {
          if (baseRequest.status === 200) {
            loadSpineWithBuffer(baseRequest.response, baseCharacterId)
          } else {
            console.error('Failed to load base character skillcut:', baseRequest.statusText)
          }
        }
        return
      }
    }
    
    if (request.status !== 200) {
      console.error('Failed to load skel file:', request.statusText)
      return
    }

    loadSpineWithBuffer(request.response, market.live2d.current_id)
  }
}

const loadSpineWithBuffer = (buffer: ArrayBuffer, characterId: string) => {
  const frURL = new FileReader()
  frURL.readAsDataURL(new Blob([buffer]))
  frURL.onload = () => {
      const skelURL: string | ArrayBuffer | null = frURL.result

      const uintArray = new Uint8Array(buffer)

      // Take the first 16 bytes
      const versionBytes = uintArray.slice(0, 16)

      // Extract and decode version string
      const versionString = new TextDecoder().decode(versionBytes).replace(/\0/g, '')

      let usedSpine

      if (/4\.0\.\d+/.test(versionString)) {
        usedSpine = spine40
      } else if (/4\.1\.\d+/.test(versionString)) {
        usedSpine = spine41
      } else {
        console.error('Unsupported Spine version:', versionString + ' | defaults to 4.1')
        usedSpine = spine41
      }

      // Set global usedSpine for overlays
      window.usedSpineGlobal = usedSpine

      // For skillcut with base character fallback, use the base character's ID in rawDataURIs
      const skelUrlKey = market.live2d.current_pose === 'skillcut' ? characterId : market.live2d.current_id
      
      // Build atlas URL - if it's a fallback skillcut, use base character's atlas
      let atlasUrl = getPathing('atlas')
      if (market.live2d.current_pose === 'skillcut' && characterId !== market.live2d.current_id) {
        atlasUrl = globalParams.PATH_L2D + characterId + '/' + globalParams.PATH_L2D_SKILLCUT + characterId + '_00_skillcut.atlas'
      }

      let initialAnimation = getDefaultAnimation()
      let needsSafeAnimationDetection = market.live2d.current_pose === 'skillcut'

      // Check if this character has a non-standard skillcut animation
      if (needsSafeAnimationDetection && skillcutAnimationOverrides[market.live2d.current_id]) {
        initialAnimation = skillcutAnimationOverrides[market.live2d.current_id]
      }

      spineCanvas = new usedSpine.SpinePlayer('player-container', {
        skelUrl: skelUrlKey,
        rawDataURIs: {
          [skelUrlKey]: skelURL
        },
        atlasUrl: atlasUrl,
        animation: initialAnimation,
        skin: market.live2d.getSkin(),
        scale: spineScale,
        backgroundColor: '#00000000',
        alpha: true,
        premultipliedAlpha: true,
        mipmaps: market.live2d.current_pose === 'fb' ? true : false,
        debug: false,
        preserveDrawingBuffer: true,
        viewport: spineViewport,
        defaultMix: SPINE_DEFAULT_MIX,
        success: (player: any) => {
          spineCanvas.animationState.data.skeletonData.defaultSkin.attachments.forEach((a: any[]) => {
            if (a) {
              const keys = Object.keys(a)
              if (keys !== null && keys !== undefined && keys.length > 0) {
                keys.forEach((k: string) => {
                  a[k as any].color = {
                    r: 1,
                    g: 1,
                    b: 1,
                    a: 1
                  }
                })
              }
            }
          })

          spinePlayer = player
          market.live2d.attachments = player.animationState.data.skeletonData.defaultSkin.attachments
          
          // Auto-detect and apply best available skin if in fb pose
          if (market.live2d.current_pose === 'fb') {
            const availableSkins = player.animationState.data.skeletonData.skins
            if (availableSkins && availableSkins.length > 0) {
              const skinNames = availableSkins.map((s: any) => s.name)
              let bestSkin = 'default'
              
              // Prefer bg, then acc, then first available non-default
              if (skinNames.includes('bg')) {
                bestSkin = 'bg'
              } else if (skinNames.includes('acc')) {
                bestSkin = 'acc'
              } else if (skinNames.length > 1) {
                // Use first non-default skin
                bestSkin = skinNames.find((name: string) => name !== 'default') || 'default'
              }
              
              if (bestSkin !== 'default') {
                player.skeleton.setSkinByName(bestSkin)
              }
            }
          }
          
          // c570 uses 'part_0' skin for cover and aim poses
          if (market.live2d.current_id === 'c570' && (market.live2d.current_pose === 'cover' || market.live2d.current_pose === 'aim')) {
            const availableSkins = player.animationState.data.skeletonData.skins
            if (availableSkins && availableSkins.length > 0) {
              const skinNames = availableSkins.map((s: any) => s.name)
              if (skinNames.includes('part_0')) {
                player.skeleton.setSkinByName('part_0')
              }
            }
          }
          
          // Load overlay skeletons if they exist (bg, fg layers)
          if (market.live2d.current_pose === 'fb') {
            loadOverlaySkeletons().then(() => {
              
              if (overlayInstances.length > 0) {
                const renderer = spineCanvas.sceneRenderer
                const originalDrawSkeleton = renderer.drawSkeleton.bind(renderer)
                const mainSkeleton = spineCanvas.skeleton // Reference to main skeleton
                let isRenderingMain = false
                let lastMainAnimTime = 0 // Track main animation time to detect restart
                
                renderer.drawSkeleton = function(skeleton: any, premultipliedAlpha: boolean) {
                  // Check if this is the main skeleton
                  if (skeleton === mainSkeleton && !isRenderingMain) {
                    isRenderingMain = true
                    
                    // Get current animation from main skeleton
                    const mainAnimEntry = player?.animationState?.getCurrent(0)
                    const animName = mainAnimEntry?.animation?.name
                    const currentAnimTime = mainAnimEntry?.trackTime || 0
                    
                    // Detect if animation has restarted (time went backwards or very small)
                    const hasRestarted = currentAnimTime < lastMainAnimTime * 0.9 // 90% threshold for restart detection
                    lastMainAnimTime = currentAnimTime
                    
                    if (animName && (hasRestarted || currentAnimTime < 0.05)) {
                      // Animation has changed or restarted - sync overlays
                      
                      // Sync background overlay
                      const bgOverlay = overlayInstances.find(o => o.source.includes('_bg'))
                      if (bgOverlay) {
                        const hasAnim = bgOverlay.state.data.skeletonData.animations.some((a: any) => a.name === animName)
                        if (hasAnim) {
                          // Clear all queued animations first
                          bgOverlay.state.clearTracks()
                          bgOverlay.state.setAnimation(0, animName, mainAnimEntry.loop)
                          // If this is a one-shot animation, queue bg_idle after it
                          if (!mainAnimEntry.loop) {
                            bgOverlay.state.addAnimation(0, 'bg_idle', true, 0)
                          }
                        }
                      }
                      
                      // Sync foreground overlay
                      const fgOverlay = overlayInstances.find(o => o.source.includes('_fg'))
                      if (fgOverlay) {
                        const hasAnim = fgOverlay.state.data.skeletonData.animations.some((a: any) => a.name === animName)
                        if (hasAnim) {
                          // Clear all queued animations first
                          fgOverlay.state.clearTracks()
                          fgOverlay.state.setAnimation(0, animName, mainAnimEntry.loop)
                          // If this is a one-shot animation, queue bg_idle after it
                          if (!mainAnimEntry.loop) {
                            fgOverlay.state.addAnimation(0, 'bg_idle', true, 0)
                          }
                        }
                      }
                    }
                    
                    // Render background first (behind main)
                    const bgOverlay = overlayInstances.find(o => o.source.includes('_bg'))
                    if (bgOverlay) {
                      bgOverlay.state.update(1 / 60)
                      bgOverlay.state.apply(bgOverlay.skeleton)
                      bgOverlay.skeleton.updateWorldTransform()
                      originalDrawSkeleton(bgOverlay.skeleton, premultipliedAlpha)
                    }
                    
                    // Render main skeleton in the middle
                    originalDrawSkeleton(skeleton, premultipliedAlpha)
                    
                    // Render foreground last (in front of main)
                    const fgOverlay = overlayInstances.find(o => o.source.includes('_fg'))
                    if (fgOverlay) {
                      fgOverlay.state.update(1 / 60)
                      fgOverlay.state.apply(fgOverlay.skeleton)
                      fgOverlay.skeleton.updateWorldTransform()
                      originalDrawSkeleton(fgOverlay.skeleton, premultipliedAlpha)
                    }
                    
                    isRenderingMain = false
                  } else if (skeleton !== mainSkeleton) {
                    // This is being called for some other skeleton, just render it
                    originalDrawSkeleton(skeleton, premultipliedAlpha)
                  }
                }
                
              } else {
              }
            })
          } else {
            overlayInstances = []
          }
          
          market.live2d.triggerFinishedLoading()
          successfullyLoaded()
        },
        error: () => {
          wrongfullyLoaded()
        }
      })
      applyDefaultStyle2Canvas()
    }
}

const customSpineLoader = () => {
  let usedSpine: any

  switch (market.live2d.customSpineVersion) {
    case 4.0:
      usedSpine = spine40
      break
    case 4.1:
      usedSpine = spine41
      break
    default:
      break
  }

  const spineCanvasOptions = {
    atlasUrl: market.live2d.customAtlas.title,
    rawDataURIs: {
      [market.live2d.customSkel.title]: market.live2d.customSkel.URI,
      [market.live2d.customAtlas.title]: market.live2d.customAtlas.URI
    },
    backgroundColor: '#00000000',
    alpha: true,
    premultipliedAlpha: market.live2d.customPremultipliedAlpha,
    mipmaps: market.live2d.current_pose === 'fb' ? true : false,
    debug: false,
    preserveDrawingBuffer: true,
    viewport: spineViewport,
    defaultMix: SPINE_DEFAULT_MIX,
    success: (player: any) => {
      spinePlayer = player
      market.live2d.attachments = player.animationState.data.skeletonData.defaultSkin.attachments
      market.live2d.triggerFinishedLoading()
      successfullyLoaded()
      try {
        if (market.live2d.customDefaultAnimationIdle) {
          const animationArray = player.animationState.data.skeletonData.animations
          const idleRegEx = /idle/

          for (let i = 0; i <= animationArray.length; i++) {
            if (idleRegEx.test(animationArray[i].name)) {
              player.config.animation = animationArray[i].name
              break
            }
          }
        }
      } catch (e) {
        console.error('Something unexpected happened with custom loader: non-nikke asset ?')
        console.error(e)
      }
      player.play()
    },
    error: () => {
      wrongfullyLoaded()
    }
  }

  for (let i = 0; i < market.live2d.customPng.length; i++) {
    spineCanvasOptions.rawDataURIs[market.live2d.customPng[i].title] = market.live2d.customPng[i].URI
  }
  // whether to load json or skel
  // @ts-ignore
  spineCanvasOptions[market.live2d.customLoader === 'skel' ? 'skelUrl' : 'jsonUrl'] = market.live2d.customSkel.title

  spineCanvas = new usedSpine.SpinePlayer('player-container', spineCanvasOptions)
}

const getPathing = (extension: string, pose?: 'aim' | 'cover' | 'fb' | 'skillcut') => {
  let route = globalParams.PATH_L2D + market.live2d.current_id + '/'

  const id = market.live2d.current_id
  const isNoSuffix = id === 'tts_c017_02'

  let fileSuffix = '_00.'

  const targetPose = pose || market.live2d.current_pose

  switch (targetPose) {
    case 'aim':
      route += globalParams.PATH_L2D_AIM
      fileSuffix = '_aim' + fileSuffix
      break
    case 'cover':
      route += globalParams.PATH_L2D_COVER
      fileSuffix = '_cover' + fileSuffix
      break
    case 'skillcut':
      route += globalParams.PATH_L2D_SKILLCUT
      // Variants (c513_01, c511_01, etc.) use just _skillcut naming (without _00 prefix)
      // Base characters use _00_skillcut
      if (id.includes('_')) {
        // It's a variant like c513_01, c511_01, etc.
        fileSuffix = '_skillcut.'
      } else {
        // It's a base character like c513, c511, etc.
        fileSuffix = '_00_skillcut.'
      }
      break
    default:
      break
  }

  // override: no suffix for this id
  const finalSuffix = isNoSuffix ? '.' : fileSuffix

  route += id + finalSuffix + extension

  return route
}

const getDefaultAnimation = (availableAnimations?: Array<{ name: string }>) => {
  if (market.live2d.current_id === 'mbg004_appearance') {
    return 'mbg004_appearance'
  }

  if (market.live2d.current_id === 'smol_rem' || market.live2d.current_id === 'smol_ram' || market.live2d.current_id === 'smol_emilia' || market.live2d.current_id === 'smol_mast_pirate' || market.live2d.current_id === 'smol_anchor_pirate' || market.live2d.current_id === 'smol_sin_pirate') {
    return 'idle_front'
  }

  // mass manufactured rapi
  if (market.live2d.current_id === 'c994') return 'idle_02'
  if (market.live2d.current_id === 'c996') return 'idle_02'

  if (market.live2d.current_id.includes('favorite')) return 'idle_merged'

  switch (market.live2d.current_pose) {
    case 'aim':
      return 'aim_idle'
    case 'cover':
      return 'cover_idle'
    case 'skillcut':
      return 'idle' // fallback to idle for skillcut
    default:
      return ['smol_anis', 'smol_prika', 'smol_mint'].includes(market.live2d.current_id) ? 'pose_idle' : 'idle'
  }
}

const checkCharacterHasPose = (pose: 'fb' | 'aim' | 'cover' | 'skillcut' | 'temp'): boolean => {
  // Auto-detection happens in PoseSelector via file verification
  // This is just a placeholder for backward compatibility
  return true
}

// Helper function to verify if a pose file exists
const verifyPoseFileExists = async (pose: 'aim' | 'cover' | 'skillcut'): Promise<boolean> => {
  try {
    const skelUrl = getPathing('skel', pose)
    const response = await fetch(skelUrl, { method: 'HEAD' })
    
    // If file not found and it's skillcut, try base character (e.g., c511_01 -> c511)
    if (!response.ok && pose === 'skillcut') {
      const characterId = market.live2d.current_id
      // Extract base character ID (e.g., c511_01 -> c511)
      const baseCharacterId = characterId.split('_')[0]
      
      if (baseCharacterId !== characterId) {
        // Try the base character's skillcut
        const baseRoute = globalParams.PATH_L2D + baseCharacterId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharacterId + '_00_skillcut.skel'
        const baseResponse = await fetch(baseRoute, { method: 'HEAD' })
        return baseResponse.ok
      }
    }
    
    return response.ok
  } catch (error) {
    return false
  }
}

import l2dData, { voiceMap, voiceGroupOverrides, setCustomZoom, actionSoundConfig, reloadSoundConfig } from '@/utils/json/l2d.js'

let currentVoice = null as null | HTMLAudioElement
let currentReloadSound = null as null | HTMLAudioElement
let currentActionSound = null as null | HTMLAudioElement
let isAimHolding = false

// Track voice index for sequential playback
const voiceIndexMap = new Map<string, number>()

// Cache to track which voice files actually exist (avoid repeated 404 attempts)
const voiceExistsCache = new Map<string, boolean>()

// Track action sound sequence - which number (1-10) should play next
let actionSoundIndex = 1

// Track reload sound sequence - which number (1-3) should play next
let reloadSoundIndex = 1

const handleAction = () => {

  if (!spinePlayer) return
  
  // Get available animations
  const animations = spinePlayer.animationState.data.skeletonData.animations
  const animationNames = animations.map((a: { name: string }) => a.name)
  
  // Determine action animation based on current pose
  let actionAnimation = 'action'
  
  // For favorite characters, use expression_merged instead
  if (market.live2d.current_id.includes('favorite')) {
    actionAnimation = 'expression_merged'
  }
  // Check special click animations config - alternate between them
  else if (specialClickAnimations[market.live2d.current_id]) {
    const animations = specialClickAnimations[market.live2d.current_id]
    // Initialize index if not exists
    if (!animationIndex[market.live2d.current_id]) {
      animationIndex[market.live2d.current_id] = 0
    }
    // Get current animation and move to next
    const currentAnim = animations[animationIndex[market.live2d.current_id]]
    animationIndex[market.live2d.current_id] = (animationIndex[market.live2d.current_id] + 1) % animations.length
    
    if (animationNames.includes(currentAnim)) {
      actionAnimation = currentAnim
    }
  }
  
  // Check if action animation exists, if not just play voice
  if (!animationNames.includes(actionAnimation)) {
    playVoice()
    return
  }
  
  spinePlayer.animationState.setAnimation(0, actionAnimation, false)

  playVoice()

  // Determine idle animation based on current pose
  let idleAnimation = 'idle'
  if (market.live2d.current_id.includes('favorite')) {
    idleAnimation = 'idle_merged'
  } else if (['smol_anis', 'smol_prika', 'smol_mint'].includes(market.live2d.current_id)) {
    idleAnimation = 'pose_idle'
  } else if (market.live2d.current_id === 'c994') {
    idleAnimation = 'idle_02'
  } else if (market.live2d.current_id === 'c996') {
    idleAnimation = 'idle_02'
  }

  // back to idle after action finish (only if idle animation exists)
  if (animationNames.includes(idleAnimation)) {
    spinePlayer.animationState.addAnimation(0, idleAnimation, true, 0)
  }
}

const successfullyLoaded = () => {
  market.load.endLoad()
  // market.message.getMessage().success(messagesEnum.MESSAGE_ASSET_LOADED, market.message.short_message)

  // Apply custom zoom after spine loads successfully
  // Only apply if user hasn't manually zoomed
  if (!hasUserZoomed) {
    setTimeout(() => {
      canvas = document.querySelector('.spine-player-canvas') as HTMLCanvasElement
      if (canvas) {
        transformScale = setCustomZoom(market.live2d.current_id, canvas, transformScale, market.live2d.current_pose)
        defaultZoomForCharacter = transformScale
      }
      // Show spine after position is applied
      isSpineHidden.value = false
    }, 50)
  } else {
    // Show immediately if user has custom zoom
    isSpineHidden.value = false
  }

  checkIfAssetCanYap()
}

const wrongfullyLoaded = () => {
  market.load.errorLoad()
  market.message.getMessage().error(messagesEnum.MESSAGE_ERROR, market.message.long_message)
}

watch(
  () => market.globalParams.isMobile,
  (e) => {
    if (e) {
      canvas && setCanvasStyleMobile()
    } else {
      applyDefaultStyle2Canvas()
      centerForPC()
    }
  }
)

watch(
  () => market.live2d.current_id,
  async () => {
    // Reset zoom flag when switching to a new character
    if (lastCharacterId !== market.live2d.current_id) {
      hasUserZoomed = false
      lastCharacterId = market.live2d.current_id
    }

    // Reset spine visibility - hide until position is applied
    isSpineHidden.value = true

    // Stop current BGM if playing
    if (currentBGM) {
      currentBGM.pause()
      currentBGM.currentTime = 0
      currentBGM = null
    }
    
    // Play BGM for oldtales
    if (market.live2d.current_id === 'oldtales') {
      currentBGM = new Audio('/assets/voice/oldtales/oldtales_bgm.ogg')
      currentBGM.loop = true
      currentBGM.volume = 0.5
      currentBGM.play().catch(err => console.log('BGM play failed:', err))
    }
    
    // Check if current pose is available for this character
    // If not, reset to fullbody before loading
    if (market.live2d.current_pose !== 'fb') {
      const poseAvailable = await verifyPoseFileExists(market.live2d.current_pose)
      if (!poseAvailable) {
        market.live2d.current_pose = 'fb'
      }
    }
    
    loadSpineAfterWatcher()
    
    // Apply custom zoom after spine loads - wait longer for canvas to be ready
    // Only apply if user hasn't manually zoomed
    if (!hasUserZoomed) {
      setTimeout(() => {
        canvas = document.querySelector('.spine-player-canvas') as HTMLCanvasElement
        if (canvas) {
          transformScale = setCustomZoom(market.live2d.current_id, canvas, transformScale, market.live2d.current_pose)
          defaultZoomForCharacter = transformScale
        }
        // Show spine after position is applied
        isSpineHidden.value = false
      }, 300)
    } else {
      // Show immediately if user has custom zoom
      isSpineHidden.value = false
    }
  }
)

watch(
  () => market.live2d.current_pose,
  async () => {
    // Reset zoom flag when switching pose (allow custom zoom for new pose)
    hasUserZoomed = false

    // Stop any playing sound effects when switching poses
    stopAllSoundEffects()
    
    // Check if the character has the required spine files for this pose
    const hasRequiredFiles = checkCharacterHasPose(market.live2d.current_pose)
    
    if (!hasRequiredFiles) {
      // Fallback to fb pose if the requested pose doesn't exist
      market.live2d.current_pose = 'fb'
      return
    }
    
    // For aim, cover, and skillcut poses, verify the file actually exists
    if (market.live2d.current_pose === 'aim' || market.live2d.current_pose === 'cover' || market.live2d.current_pose === 'skillcut') {
      const fileExists = await verifyPoseFileExists(market.live2d.current_pose)
      if (!fileExists) {
        console.warn(`${market.live2d.current_pose} pose file not found for ${market.live2d.current_id}, falling back to fb`)
        market.live2d.current_pose = 'fb'
        return
      }
    }
    
    loadSpineAfterWatcher()
  }
)

watch(
  () => market.live2d.resetPlacement,
  () => {
    hasUserZoomed = false
    
    // Reset transformScale to base value
    transformScale = market.live2d.HQassets ? 0.18 : 0.5
    
    applyDefaultStyle2CanvasImmediate()
    
    // Hide spine temporarily while position is being reset
    isSpineHidden.value = true
    
    // Reapply custom zoom after reset immediately
    setTimeout(() => {
      canvas = document.querySelector('.spine-player-canvas') as HTMLCanvasElement
      if (canvas) {
        transformScale = setCustomZoom(market.live2d.current_id, canvas, transformScale, market.live2d.current_pose)
        defaultZoomForCharacter = transformScale
      }
      // Show spine after position is applied
      isSpineHidden.value = false
    }, 50)
  }
)

watch(
  () => market.live2d.screenshot,
  () => {
    if (!checkMobile()) {
      const sc_sz = localStorage.getItem('sc_sz')
      const old_sc_sz = canvas ? canvas.style.height : '0'
      canvas && (canvas.style.height = sc_sz + 'px')

      setTimeout(() => {
        takeScreenshot()
        canvas && (canvas.style.height = old_sc_sz)
      }, 250)
    } else {
      takeScreenshot()
    }
  }
)

watch(
  () => market.live2d.exportAnimationTimestamp,
  (newVal, oldVal) => {
    if (newVal !== oldVal) {
      exportAnimationFrames(newVal)
    }
  }
)

watch(
  () => market.live2d.customLoad,
  () => {
    spineCanvas.dispose()
    market.load.beginLoad()
    customSpineLoader()
    applyDefaultStyle2Canvas()
  }
)

watch(
  () => market.live2d.hideUI,
  () => {
    const controls = document.querySelector('.spine-player-controls') as HTMLElement
    if (market.live2d.hideUI === false) {
      controls.style.visibility = 'visible'
    } else {
      controls.style.visibility = 'hidden'
    }
  }
)

const takeScreenshot = () => {
  if (!canvas) return
  const dataURL = canvas.toDataURL()

  const link = document.createElement('a')

  link.download = 'NIKKE-DB_' + market.live2d.current_id + '_' + market.live2d.current_pose + '_' + new Date().getTime().toString().slice(-3) + '.png'

  link.href = dataURL

  link.click()
}

// VP9 may be too performance intensive. VP8 or VP9 MUST be explicitly specified for alpha transparency to work.
const RECORDING_MIME_TYPE = 'video/webm;codecs=vp8'
const RECORDING_BITRATE = 12000000
const RECORDING_FRAME_RATE = 30
const RECORDING_TIME_SLICE = 10

async function startRecording(spinePlayer: any, currentAnimation: string, timestamp: number) {
  return new Promise<void>((resolve, reject) => {
    const chunks: BlobPart[] | undefined = [] // Store recorded media chunks (Blobs)
    const stream = canvas ? canvas.captureStream(RECORDING_FRAME_RATE) : new MediaStream() // Grab our canvas MediaStream
    const rec = new MediaRecorder(stream, { mimeType: RECORDING_MIME_TYPE, videoBitsPerSecond: RECORDING_BITRATE }) // Initialize the MediaRecorder

    rec.onerror = (e) => reject(e) // Reject the promise on error

    rec.ondataavailable = (e) => {
      chunks.push(e.data)
    }

    // Only when the recorder stops, construct a complete Blob from all the chunks
    rec.onstop = async () => {
      spinePlayer.pause()

      const blob: BlobPart = new Blob(chunks, { type: 'video/webm' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = 'animation_frames_' + timestamp + '.webm'
      link.href = url
      link.click()
      URL.revokeObjectURL(url) // Clean up
      resolve()
    }

    rec.onresume = () => {}

    rec.onstart = () => {
      spinePlayer.play()
      requestAnimationFrame(checkCondition)
    }

    // This is important, the timeslice has to be low or the lag is high and the loop won't look right.
    rec.start(RECORDING_TIME_SLICE)

    function checkCondition() {
      if (spinePlayer.animationState.tracks && spinePlayer.animationState.tracks[0] && spinePlayer.animationState.tracks[0].animationLast !== -1 && spinePlayer.animationState.tracks[0].animationLast === spinePlayer.animationState.tracks[0].animationEnd) {
        rec.stop()
      } else {
        requestAnimationFrame(checkCondition)
      }
    }
  })
}

async function exportAnimationFrames(timestamp: number) {
  if (spineCanvas && spinePlayer) {
    if (market.live2d.exportAnimationColoredBackground) {
      let bgColor = document.body.style.backgroundColor.replace('rgb(', '').replace(')', '').split(',')
      spinePlayer.bg.r = parseInt(bgColor[0].trim()) / 255
      spinePlayer.bg.g = parseInt(bgColor[1].trim()) / 255
      spinePlayer.bg.b = parseInt(bgColor[2].trim()) / 255
      spinePlayer.bg.a = 100
    }
    const currentAnimation = spineCanvas.config.animation
    spinePlayer.playerControls.style.visibility = 'hidden'
    spinePlayer.animationState.data.defaultMix = 0
    spinePlayer.animationState.setAnimation(0, currentAnimation)
    spinePlayer.setAnimation(currentAnimation, false)
    spinePlayer.animationState.data.defaultMix = SPINE_DEFAULT_MIX
    spinePlayer.pause()

    market.message.getMessage().success(messagesEnum.MESSAGE_EXPORT_ANIMATION, market.message.short_message)

    market.live2d.isExportingAnimation = true
    startRecording(spinePlayer, currentAnimation, timestamp)
      .then(() => {
        market.message.getMessage().success(messagesEnum.MESSAGE_EXPORT_ANIMATION_SUCCESS, market.message.short_message)
      })
      .catch((err: any) => {
        market.message.getMessage().error(messagesEnum.MESSAGE_EXPORT_ANIMATION_FAILED, market.message.short_message)
        console.error(err)
      })
      .finally(() => {
        market.live2d.isExportingAnimation = false
        spinePlayer.animationState.data.defaultMix = SPINE_DEFAULT_MIX
        spinePlayer.play()
        spinePlayer.setAnimation(currentAnimation, true)
        spinePlayer.playerControls.style.visibility = 'visible'
        spinePlayer.bg.r = 0
        spinePlayer.bg.g = 0
        spinePlayer.bg.b = 0
        spinePlayer.bg.a = 0
      })
  } else {
    market.message.getMessage().error(messagesEnum.MESSAGE_EXPORT_ANIMATION_FAILED, market.message.short_message)
    console.error('spineCanvas is not properly initialized or accessible.')
  }
}

const loadSpineAfterWatcher = () => {
  if (market.live2d.canLoadSpine) {
    // Verify the character has the required pose before attempting to load
    if (!checkCharacterHasPose(market.live2d.current_pose)) {
      console.warn(`Character ${market.live2d.current_id} does not have ${market.live2d.current_pose} pose, falling back to fb`)
      market.live2d.current_pose = 'fb'
      return
    }
    
    spineCanvas.dispose()
    market.load.beginLoad()
    spineLoader()
    applyDefaultStyle2Canvas()
  }
}

const applyDefaultStyle2Canvas = () => {
  setTimeout(() => {
    canvas = document.querySelector('.spine-player-canvas') as HTMLCanvasElement

    if (!canvas) return

    canvas.width = canvas.height

    if (checkMobile()) {
      setCanvasStyleMobile()
    } else {
      canvas.style.height = market.live2d.HQassets ? '438vh' : '168vh'
      canvas.style.marginTop = market.live2d.HQassets ? 'calc(-171vh)' : 'calc(-30vh)'
      canvas.style.transform = market.live2d.HQassets ? 'scale(0.294)' : 'scale(0.7)'
      canvas.style.position = 'absolute'
      canvas.style.left = '0px'
      canvas.style.top = '0px'
      transformScale = market.live2d.HQassets ? 0.18 : 0.5
      market.globalParams.showMobileHeader()
      centerForPC()
    }
  }, 50)
}

const applyDefaultStyle2CanvasImmediate = () => {
  canvas = document.querySelector('.spine-player-canvas') as HTMLCanvasElement

  if (!canvas) return

  canvas.width = canvas.height

  if (checkMobile()) {
    setCanvasStyleMobile()
  } else {
    canvas.style.height = market.live2d.HQassets ? '438vh' : '168vh'
    canvas.style.marginTop = market.live2d.HQassets ? 'calc(-171vh)' : 'calc(-30vh)'
    canvas.style.transform = market.live2d.HQassets ? 'scale(0.294)' : 'scale(0.7)'
    canvas.style.position = 'absolute'
    canvas.style.left = '0px'
    canvas.style.top = '0px'
    transformScale = market.live2d.HQassets ? 0.18 : 0.5
    market.globalParams.showMobileHeader()
    centerForPC()
  }
}

const setCanvasStyleMobile = () => {
  if (!canvas) return

  canvas.style.height = '90vh'
  canvas.style.width = '100%'
  transformScale = 1
  market.globalParams.hideMobileHeader()
}

const checkMobile = () => {
  return market.globalParams.isMobile ? true : false
}

const centerForPC = () => {
  const canvas_width = canvas ? canvas.offsetWidth : 0
  const viewport_width = window.innerWidth
  canvas && (canvas.style.left = (viewport_width - canvas_width) / 2 + 'px')
}

const filterDomEvents = (event: any) => {
  if (event.target === canvas || event.target === document.querySelector('.spine-player')) {
    return true
  } else {
    return false
  }
}

/**
 * click to drag the character around,
 * will move the canvas through the dom based on coordinates of the cursor
 */

let oldX: number
let oldY: number
let move = false as boolean

document.addEventListener('mousedown', (e) => {
  if (filterDomEvents(e)) {
    oldX = e.clientX
    oldY = e.clientY
    move = true
  }
})

document.addEventListener('mouseup', () => {
  oldX = 0
  oldY = 0
  move = false
})

document.addEventListener('mousemove', (e) => {
  if (move && canvas) {
    const newX = e.clientX
    const newY = e.clientY

    const stylel = parseInt(canvas.style.left.replaceAll('px', ''))
    const stylet = parseInt(canvas.style.top.replaceAll('px', ''))

    if (newX !== oldX) {
      canvas.style.left = stylel + (newX - oldX) + 'px'
    }

    if (newY !== oldY) {
      canvas.style.top = stylet + (newY - oldY) + 'px'
    }

    oldX = newX
    oldY = newY
  }
})

/**
 * zoom in or out for the live2d
 * it uses the property transform scale instead of buffing up or down viewport height of the canvas
 * using the vh in nikke db legacy produces some lag when zooming at high values ( 450 - 500 vh of size)
 * transform should hopefully fix this issue, but to fix blurring/pixelated images
 * the canvas is already bruteforced to 500vh and transform scale 0.2
 * since the zoom is smooth there is no reason to limit it like in nikke db legacy
 * however after scale(1) it'll start getting blurried than usual
 * though I don't see the point as it is already pixelated enough
 */

let transformScale = 0.5

document.addEventListener('wheel', (e) => {
  if (filterDomEvents(e)) {
    // Mark that user has manually zoomed
    hasUserZoomed = true

    if (!canvas) return

    // Get the actual current scale from the canvas transform
    const currentTransform = canvas.style.transform
    const scaleMatch = currentTransform.match(/scale\(([\d.]+)\)/)
    const currentScale = scaleMatch ? parseFloat(scaleMatch[1]) : transformScale

    let newScale = currentScale

    switch (e.deltaY > 0) {
      case true:
        newScale -= 0.02
        break
      case false:
        newScale += 0.02
        break
      default:
        break
    }

    // Clamp the transform scale to prevent going below minimum or into negative values
    const MIN_SCALE = 0.05
    const MAX_SCALE = 5.0
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale))

    transformScale = newScale
    canvas.style.transform = 'scale(' + newScale + ')'
  }
})

/**
 * Yap or talking mode for the normal people;
 * first of all begin with checking if a talk_start animation exists in the spine
 * if it does, activate the checkbox, otherwise disable it
 * once activated, add the animation & play it on top of the current track,
 * once deactivated, remove the talking track and let only the regular animation play
 */

const YAP_TRACK = 'talk_start'

const checkIfAssetCanYap = () => {
  let yappable = false
  if (market.live2d.current_pose === 'fb') {
    const animations = spineCanvas.animationState.data.skeletonData.animations
    animations.forEach((a: { name: string }) => {
      if (a.name === YAP_TRACK) {
        yappable = true
      }
    })
  }
  setYappable(yappable)
}

const setYappable = (bool: boolean) => {
  market.live2d.canYap = bool
  market.live2d.isYapping = false
}

watch(
  () => market.live2d.isYapping,
  (value) => {
    if (value) {
      spineCanvas.animationState.addAnimation(1, YAP_TRACK)
      spineCanvas.animationState.setAnimation(1, YAP_TRACK, true)
    } else {
      spineCanvas.animationState.tracks = [spineCanvas.animationState.tracks[0]]
    }
  }
)

/**
 * Attachment / Layer edition
 */
watch(
  () => market.live2d.applyAttachments,
  () => {
    spineCanvas.animationState.data.skeletonData.defaultSkin.attachments = [...market.live2d.attachments]
  },
  { deep: true }
)

// preview layer
// if we ARE previewing :
// first off we find the requested layer
// afterward we backup it's color data
// then we apply the preview
// once we stop previewing we apply the backedup color back to the layer
let allColorsBackedUp = new Map() as Map<string, AttachmentItemColorInterface>
let intervalid = null as null | number

watch(
  () => market.live2d.layerPreviewMode,
  () => {
    if (market.live2d.layerEditorPreviewObj.preview) {
      spineCanvas.animationState.data.skeletonData.defaultSkin.attachments.forEach((a: any[]) => {
        if (a) {
          const keys = Object.keys(a)
          if (keys !== null && keys !== undefined && keys.length > 0) {
            keys.forEach((k: string) => {
              allColorsBackedUp.set(k, JSON.parse(JSON.stringify(a[k as any].color)))
            })
          }
        }
      })

      const PREVIEW_MODE = 1

      if (PREVIEW_MODE === 1) {
        triggerPreview1()
      }
    } else {
      if (intervalid) {
        clearInterval(intervalid)
      }

      spineCanvas.animationState.data.skeletonData.defaultSkin.attachments.forEach((a: any[]) => {
        if (a) {
          const keys = Object.keys(a)
          if (keys !== null && keys !== undefined && keys.length > 0) {
            keys.forEach((k: string) => {
              a[k as any].color = allColorsBackedUp.get(k)
            })
          }
        }
      })
    }
  }
)

const triggerPreview1 = () => {
  let toShow = 'r'

  intervalid = setInterval(() => {
    const colors = {
      r: toShow === 'r' ? 2 : 0,
      g: toShow === 'g' ? 2 : 0,
      b: toShow === 'b' ? 2 : 0,
      a: 1
    }
    toShow = toShow === 'r' ? 'g' : toShow === 'g' ? 'b' : 'r'
    spineCanvas.animationState.data.skeletonData.defaultSkin.attachments[market.live2d.layerEditorPreviewObj.index][market.live2d.layerEditorPreviewObj.key].color = colors
  }, 250) as any
}
</script>

<style scoped lang="less">
#player-container {
  //height: calc(100vh - 100px);
  overflow: hidden;
  
  &.spine-hidden {
    visibility: hidden;
  }
}
.mobile {
  height: -webkit-fill-available;
  width: 100%;
}

.computer {
  height: 100vh;
  margin-top: -100px;
}
</style>
