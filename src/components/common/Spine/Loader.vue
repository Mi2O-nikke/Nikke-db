<template>
  <div id="player-container" :class="[checkMobile() ? 'mobile' : 'computer', { 'spine-hidden': isSpineHidden, 'cover': market.live2d.current_pose === 'cover' }]"></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch, ref } from 'vue'
import { useMarket } from '@/stores/market'

// @ts-ignore
import spine40 from '@/utils/spine/spine-player4.0'
// @ts-ignore
import spine41 from '@/utils/spine/spine-player4.1'

import { globalParams, messagesEnum } from '@/utils/enum/globalParams'
import type { AttachmentInterface, AttachmentItemColorInterface } from '@/utils/interfaces/live2d'
import { specialClickAnimations, charactersWithFgBgOverlays, charactersWithDualLayer, skillcutAnimationOverrides, skillcutConfig, characterSkins, characterFullbodySkins, characterDefaultAnimations, voiceGroupOverrides } from '@/utils/json/l2d'
import { preloadCoverModeAssets, preloadSkillcutModeAssets, isPreloaded } from '@/utils/spine/preloadManager'
import { preloadFullbodyModeAssets } from '@/utils/spine/preloadManager'

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

// Track aim hold state
let isAimHolding = false
let hasLoadedAimSpine = false
let pendingSwitchTimeout: NodeJS.Timeout | null = null
let lastAimClickTime = 0  // Track last aim click time for debouncing
let currentFireLoopTimer: NodeJS.Timeout | null = null  // Track fire loop so we can stop it on click
let currentGaugeupFlag = ''  // Track which gaugeup flag (r or e) is used for this hold session
let currentAudioMode = ''  // Track audio mode (m for ramping)
let customGaugeupMode = false  // Track if using custom character gaugeup (s flag)
let customGaugeupPlayed = false  // Track if custom gaugeup has already played (s flag)
let rampingFireTimeouts: NodeJS.Timeout[] = []  // Track ramping fire timeouts so we can clear them
let rampingStarted = false  // Track if ramping sequence has already been started
let currentWebAudioSource: any = null  // Track Web Audio BufferSource for fire_loop

// Multi-skeleton support for c515
interface OverlayInstance {
  skeleton: any
  state: any
  segments: any[]
  source: string
}
let overlayInstances: OverlayInstance[] = []
let usedSpine: any = null

// Dual-layer spine support (same skeleton, different animations)
interface DualLayerInstance {
  skeleton: any
  state: any
  backAnimation: string
}
let dualLayerInstance: DualLayerInstance | null = null

// BGM tracking
let currentBGM: HTMLAudioElement | null = null

// Track skillcut overlay sound separately so it can be stopped
let currentSkillcutOverlaySound: HTMLAudioElement | null = null

// Extend window for storing Spine library
declare global {
  interface Window {
    usedSpineGlobal?: any
  }
}

// http://esotericsoftware.com/spine-player#Viewports
const getSpineViewport = (pose?: string) => {
  // Cover mode needs more space for aim skeleton (less padding)
  if (pose === 'cover') {
    return {
      padLeft: '20%',
      padRight: '85%',
      padTop: '20%',
      padBottom: '20%'
    }
  }
  
  // Default for other modes
  return {
    padLeft: '20%',
    padRight: '20%',
    padTop: '20%',
    padBottom: '20%'
  }
}

const spineScale = 1.2

// Track if we're currently preloading
let isCurrentlyPreloading = false

// Preload assets based on current pose and character
const preloadForCurrentState = async (): Promise<void> => {
  const currentPose = market.live2d.current_pose
  const charId = market.live2d.current_id
  const charConfig = l2dData.find(c => c.id === charId)
  
  if (currentPose === 'cover') {
    return preloadCoverModeAssets(charId, true, charConfig)
  } else if (currentPose === 'fb') {
    return preloadFullbodyModeAssets(charId, true, voiceGroupOverrides)
  } else if (currentPose === 'skillcut') {
    return preloadSkillcutModeAssets(charId, true)
  }
  
  // If no matching pose, return resolved promise
  return Promise.resolve()
}

onMounted(() => {
  market.load.beginLoad()
  spineLoader()
  setupClickListener()
})

// Watch for character ID changes - preload assets for new character BEFORE showing
watch(
  () => market.live2d.current_id,
  async () => {
    // Start preload and WAIT for it to complete before continuing
    try {
      await preloadForCurrentState()
    } catch (e) {
      console.warn('[Preload] Preload error, continuing anyway:', e)
    }
  }
)

// Watch for pose changes - preload assets
watch(
  () => market.live2d.current_pose,
  async (newPose) => {
    // For skillcut mode, wait for preload before continuing
    if (newPose === 'skillcut') {
      try {
        await preloadForCurrentState()
      } catch (e) {
        console.warn('[Preload] Skillcut preload error:', e)
      }
    } else {
      // For other poses, preload in background (don't wait)
      preloadForCurrentState()
    }
  }
)

// Clean up zoom animation frame on unmount
onUnmounted(() => {
  if (zoomFrameId !== null) {
    cancelAnimationFrame(zoomFrameId)
    zoomFrameId = null
  }
})

const setupClickListener = () => {
  // Listen on document to catch all clicks, then filter
  document.addEventListener('mousedown', (e) => handleActionStart(e))
  document.addEventListener('mouseup', handleActionEnd)
  
  // Middle-click (button 1) for cover_hit motion in cover mode
  document.addEventListener('mousedown', (e) => {
    if (e.button === 1) {  // Middle-click
      handleCoverHit(e)
    }
  })
  
  // Disable middle-click auto-scrolling on cover mode
  document.addEventListener('mousedown', (e) => {
    const container = document.getElementById('player-container')
    if (container?.classList.contains('cover') && e.button === 1) {
      e.preventDefault()
    }
  }, true)
  
  // Disable right-click context menu on canvas
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement
    const isOnCanvas = target === canvas || canvas?.contains(target)
    if (isOnCanvas) {
      e.preventDefault()
    }
  })
}

const handleActionStart = async (e?: MouseEvent) => {
  if (!spinePlayer || !canvas) return
  
  // Only trigger on left-click (button 0)
  if (e?.button !== 0) return

  const target = e?.target as HTMLElement
  if (!target) return

  // Only trigger action if click is on the canvas or inside it
  // Use DOM hierarchy, not visual position (works with transforms)
  const isOnCanvas = target === canvas || canvas.contains(target)
  
  if (!isOnCanvas) {
    return  // Click is not on canvas, ignore
  }

  // Check if clicking is over UI panels - if so, don't trigger action
  const isUiPanel = target.closest('#l2dsearchbox') ||     // Left character list panel
                   target.closest('.toolList')              // Right tools panel
  
  if (isUiPanel) {
    return  // Don't trigger action on UI
  }

  // For cover pose - click to show aim, release to show cover
  if (market.live2d.current_pose === 'cover') {
    
    // Debounce rapid clicks - ignore if less than 100ms since last click
    const now = Date.now()
    if (now - lastAimClickTime < 100) {
      return
    }
    lastAimClickTime = now
    
    // Set holding flag
    isAimHolding = true
    rampingStarted = false  // Reset ramping flag for new hold
    customGaugeupPlayed = false  // Reset custom gaugeup flag for new hold
    
    // Set gaugeup flag and audio mode from character config
    const charId = market.live2d.current_id
    const charConfig = l2dData.find(c => c.id === charId)
    currentGaugeupFlag = charConfig?.timing?.gaugeupFlag || ''
    currentAudioMode = charConfig?.timing?.audioMode || ''
    customGaugeupMode = charConfig?.timing?.customGaugeup || false
    
    // Stop only FX timeouts (let voice play to end)
    stopReloadFxOnly()
    
    try {
      const charId = market.live2d.current_id
      const clickStartTime = performance.now()
      const preloaded = isPreloaded(charId)
      
      // Step 1: Load aim skeleton immediately (no to_aim on cover)
      const aimSkelResponse = await fetch(`/assets/l2d/${charId}/aim/${charId}_aim_00.skel`)
      const aimAtlasResponse = await fetch(`/assets/l2d/${charId}/aim/${charId}_aim_00.atlas`)
      
      const fetchTime = performance.now() - clickStartTime
      
      if (!aimSkelResponse.ok || !aimAtlasResponse.ok) {
        throw new Error('Failed to fetch aim files')
      }
      
      const aimSkelBuffer = await aimSkelResponse.arrayBuffer()
      
      const SpineLib = (window as any).usedSpineGlobal
      const assetMgr = new SpineLib.AssetManager(spineCanvas.context, '')
      
      // Create blob for skeleton
      const skelBlob = new Blob([aimSkelBuffer])
      const skelUrl = URL.createObjectURL(skelBlob)
      
      assetMgr.loadBinary(skelUrl)
      assetMgr.loadTextureAtlas(`/assets/l2d/${charId}/aim/${charId}_aim_00.atlas`)
      await assetMgr.loadAll()
      
      const binary = assetMgr.require(skelUrl)
      const atlas = assetMgr.require(`/assets/l2d/${charId}/aim/${charId}_aim_00.atlas`)
      const skeletonBinary = new SpineLib.SkeletonBinary(new SpineLib.AtlasAttachmentLoader(atlas))
      const skeletonData = skeletonBinary.readSkeletonData(binary)
      
      const aimSkeleton = new SpineLib.Skeleton(skeletonData)
      aimSkeleton.scaleX = spinePlayer.skeleton.scaleX
      aimSkeleton.scaleY = spinePlayer.skeleton.scaleY
      aimSkeleton.x = spinePlayer.skeleton.x
      aimSkeleton.y = spinePlayer.skeleton.y
      
      // Sync root bone position to match cover skeleton exactly
      try {
        if (aimSkeleton.getRootBone && spinePlayer.skeleton.getRootBone) {
          const aimRootBone = aimSkeleton.getRootBone()
          const coverRootBone = spinePlayer.skeleton.getRootBone()
          if (aimRootBone && coverRootBone) {
            aimRootBone.x = coverRootBone.x
            aimRootBone.y = coverRootBone.y
            aimRootBone.scaleX = coverRootBone.scaleX
            aimRootBone.scaleY = coverRootBone.scaleY
            aimRootBone.rotation = coverRootBone.rotation
          }
        }
      } catch (e) {
        // Ignore if getRootBone doesn't exist
      }
      
      const aimState = new SpineLib.AnimationState(new SpineLib.AnimationStateData(skeletonData))
      
      // Apply skin to aim skeleton if configured
      const aimSkinName = characterSkins[charId]
      if (aimSkinName) {
        const availableSkins = skeletonData.skins
        if (availableSkins && availableSkins.length > 0) {
          const skinNames = availableSkins.map((s: any) => s.name)
          if (skinNames.includes(aimSkinName)) {
            aimSkeleton.setSkinByName(aimSkinName)
          }
        }
      }
      
      // Store aim skeleton as overlay
      const aimOverlay = {
        skeleton: aimSkeleton,
        state: aimState,
        segments: [],
        source: `${charId}_aim`
      }
      
      overlayInstances = [aimOverlay]
      
      const setupTime = performance.now() - clickStartTime
      
      // Step 2: Play to_aim on aim skeleton, then chain to aim_fire or aim_hit
      const aimAnimations = aimState.data.skeletonData.animations
      const hasToAim = aimAnimations.some((a: any) => a.name === 'to_aim')
      const hasAimFire = aimAnimations.some((a: any) => a.name === 'aim_fire')
      const hasAimHit = aimAnimations.some((a: any) => a.name === 'aim_hit')
      
      // Check if character config specifies aim_hit instead of aim_fire
      const charConfig = l2dData.find(c => c.id === charId)
      const useAimHit = charConfig?.zoomAnimationType === 'hit'
      const targetAnim = useAimHit && hasAimHit ? 'aim_hit' : (hasAimFire ? 'aim_fire' : (hasAimHit ? 'aim_hit' : null))
    
      
      if (hasToAim) {
        // Play to_aim then chain aim_fire or aim_hit (depending on config)
        aimState.setAnimation(0, 'to_aim', false)
        
        // Chain first animation after to_aim (non-looping) with delay if configured
        if (targetAnim) {
          let delay = 0
          let loopDuration = 0
          // Get timing from separate timing config
          if (charConfig?.timing) {
            delay = charConfig.timing.delay || 0
            loopDuration = charConfig.timing.loopDuration || 0
          }
          
          // For alternating hit/idle, skip the initial animation and let the loop handle it
          const repeatFlag = charConfig?.timing?.repeatFlag || ''
          const shouldAlternate = repeatFlag === 'r' || repeatFlag === 'e'
          if (!(useAimHit && shouldAlternate)) {
            // Normal case: add initial animation
            // But if loopDuration is set, skip this - let startLooping handle all animations
            if (!(loopDuration > 0)) {
              aimState.addAnimation(0, targetAnim, false, delay)
            }
          }
          
          // Check if we should play fire sound immediately when delay = 0
          let playedFireLoop = false
          if (delay === 0 && currentAudioMode !== 'm') {  // Skip this for ramping mode
            playedFireLoop = true
            
            // Use loopDuration as the interval, or default to sound file duration
            const fireInterval = loopDuration > 0 ? loopDuration : 0.5
            
            // Play fire sound immediately and loop on timer
            let fireTimer: NodeJS.Timeout | null = null
            const playFireLoop = () => {
              if (isAimHolding) {
                playAimFireSound(charId, targetAnim)
                
                // Schedule next loop
                fireTimer = setTimeout(playFireLoop, fireInterval * 1000)
                currentFireLoopTimer = fireTimer  // Track globally
              } else if (fireTimer) {
                clearTimeout(fireTimer)
                currentFireLoopTimer = null
              }
            }
            
            // Start immediately after to_aim finishes
            const toAimAnim = aimAnimations.find((a: any) => a.name === 'to_aim')
            const toAimDuration = toAimAnim?.duration || 0.5
            setTimeout(playFireLoop, toAimDuration * 1000)
            
            // Also restart animation every loopDuration if loopDuration is set
            if (loopDuration > 0) {
              let animLoopTimer: NodeJS.Timeout | null = null
              const loopAnimation = () => {
                if (isAimHolding) {
                  aimState.setAnimation(0, targetAnim, false, 0)
                  animLoopTimer = setTimeout(loopAnimation, loopDuration * 1000)
                } else if (animLoopTimer) {
                  clearTimeout(animLoopTimer)
                }
              }
              setTimeout(loopAnimation, toAimDuration * 1000)
            }
          }
          
          // If loop duration is set, use timer to restart animation at fixed intervals
          // (but skip if we already played the fire loop above)
          if (loopDuration > 0 && !playedFireLoop) {
            // Get animation duration
            const targetAnimObj = aimAnimations.find((a: any) => a.name === targetAnim)
            const targetAnimDuration = targetAnimObj?.duration || 0.5
            
            // Check if we should alternate between delay and loopDuration
            let shouldAlternate = repeatFlag === 'r' || repeatFlag === 'e'
            let isAlternatingDelay = false  // Track which value we're using
            
            let loopTimer: NodeJS.Timeout | null = null
            let cycleCount = 0  // Track which cycle we're on
            let isFirstCycle = true  // Track if this is the first cycle
            
            // Determine if we should play gaugeup or just fire
            // Play gaugeup if: currentGaugeupFlag is set (r or e flag) OR delay > 0
            const playGaugeUp = currentGaugeupFlag !== '' || delay > 0
            const fireStartDelay = playGaugeUp ? 0 : 0.5  // Fire starts after gaugeup, or after 0.5s if no gaugeup
            
            // Check if we should play any sounds (alternating mode OR delay=0 OR playGaugeUp)
            const shouldPlaySounds = shouldAlternate || delay === 0 || playGaugeUp
            
            const startLooping = () => {
              if (!isAimHolding) {
                if (loopTimer) clearTimeout(loopTimer)
                return
              }
              
              // Determine which animation to play
              let animToPlay = targetAnim
              if (useAimHit && shouldAlternate) {
                // First cycle: idle, then all subsequent: hit
                animToPlay = isFirstCycle ? 'aim_idle' : 'aim_hit'
              }
              
              aimState.setAnimation(0, animToPlay, false)
              
              // Play voice for this cycle
              // Skip gaugeup on first cycle for non-alternating (already played immediately on click)
              if (shouldPlaySounds) {
                
                if (playGaugeUp && isFirstCycle && shouldAlternate) {
                  // For alternating (c272): play gaugeup on first cycle
                  playAimGaugeUpSound(charId, currentGaugeupFlag, () => {
                    if (isAimHolding) {
                      playAimFireSound(charId, targetAnim)
                    }
                  })
                } else if (playGaugeUp && isFirstCycle && !shouldAlternate && currentGaugeupFlag !== '') {
                  // For gaugeup flag (e): play gaugeup on first cycle too
                  playAimGaugeUpSound(charId, currentGaugeupFlag, () => {
                    if (isAimHolding) {
                      playAimFireSound(charId, targetAnim)
                    }
                  })
                } else if (!playGaugeUp) {
                  // No gaugeup, just play fire sound after delay
                  
                  // If in ramping audio mode, play ramping sequence on FIRST TIME ONLY
                  if (currentAudioMode === 'm' && !rampingStarted) {
                    rampingStarted = true
                    playRampingFireSequence(charId, targetAnim, loopDuration)
                    
                    // Also sync animation with audio ramping timings
                    playRampingAnimationSequence(aimState, targetAnim, loopDuration)
                  } else if (currentAudioMode !== 'm') {
                    // Normal fire mode (not ramping)
                    setTimeout(() => {
                      if (isAimHolding) {
                        playAimFireSound(charId, targetAnim)
                      }
                    }, fireStartDelay * 1000)
                  }
                  // If ramping mode and already started, don't do anything (fire_loop is playing)
                } else if (playGaugeUp && isFirstCycle && !shouldAlternate) {
                  // For non-alternating (c511): gaugeup already played, just play fire
                  playAimFireSound(charId, targetAnim)
                } else if (playGaugeUp && !isFirstCycle) {
                  // For subsequent cycles: keep playing gaugeup if currentGaugeupFlag is set
                  // BUT: if customGaugeupMode (s flag), only play gaugeup once on first cycle
                  if (!customGaugeupMode) {
                    playAimGaugeUpSound(charId, currentGaugeupFlag, () => {
                      if (isAimHolding) {
                        playAimFireSound(charId, targetAnim)
                      }
                    })
                  } else {
                    // Custom gaugeup mode: just play fire on subsequent cycles
                    playAimFireSound(charId, targetAnim)
                  }
                }
              }
              
              cycleCount++
              
              // Determine next cycle time
              let nextCycleTime = loopDuration
              if (shouldAlternate && useAimHit) {
                // For alternating (c272): first cycle uses delay, then always use loopDuration
                nextCycleTime = isFirstCycle ? delay : loopDuration
                isFirstCycle = false
              } else {
                // For non-alternating (c511): always use loopDuration after first cycle
                // (delay was already added before first startLooping call)
                nextCycleTime = loopDuration
                isFirstCycle = false
              }
              
              loopTimer = setTimeout(startLooping, nextCycleTime * 1000)
            }
      // For non-alternating with gaugeup AND delay (like c511): play gaugeup sound immediately when holding
      // Sound plays immediately before loop starts, but only if there's an actual delay
      if (playGaugeUp && !shouldAlternate && loopDuration > 0 && delay > 0 && currentGaugeupFlag === '') {
        playAimGaugeUpSound(charId, currentGaugeupFlag, () => {
          // Fire sound will be played when animation loop starts
        })
      }
      
            // Start loop after to_aim finishes (for alternating case)
            if (useAimHit && shouldAlternate) {
              const toAimAnim = aimAnimations.find((a: any) => a.name === 'to_aim')
              const toAimDuration = toAimAnim?.duration || 0.5
              setTimeout(startLooping, toAimDuration * 1000)
            } else {
              // For normal case, start after to_aim finishes
              const toAimAnim = aimAnimations.find((a: any) => a.name === 'to_aim')
              const toAimDuration = toAimAnim?.duration || 0.5
              // Only add delay if no gaugeup flag (c511 style that plays gaugeup immediately)
              const initialDelay = (isFirstCycle && delay > 0 && currentGaugeupFlag === '') ? delay : 0
              setTimeout(startLooping, (toAimDuration + initialDelay) * 1000)
            }
          } else {
            // No loop duration set, just loop normally
            aimState.addAnimation(0, targetAnim, true, 0)
          }
        }
      } else if (targetAnim) {
        // Fallback: play target animation (non-looping) with delay, then loop with duration
        let delay = 0
        let loopDuration = 0
        // Get timing from separate timing config
        if (charConfig?.timing) {
          delay = charConfig.timing.delay || 0
          loopDuration = charConfig.timing.loopDuration || 0
        }
        aimState.setAnimation(0, targetAnim, false, delay)
        aimState.addAnimation(0, targetAnim, true, loopDuration)  // loop with duration delay
      } else {
      }
      
      // Hide cover skeleton so only aim is visible
      spinePlayer.skeleton.scaleX = 0
      spinePlayer.skeleton.scaleY = 0
      
    } catch (error) {
      console.error('❌ Error in cover aim sequence:', error)
      isAimHolding = false
      
      // Fallback: show cover normally
      spinePlayer.skeleton.scaleX = 1
      spinePlayer.skeleton.scaleY = 1
    }
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
    rampingStarted = false  // Reset ramping flag for new hold
    customGaugeupPlayed = false  // Reset custom gaugeup flag for new hold
    
    // Set gaugeup flag and audio mode from character config
    const charId = market.live2d.current_id
    const charConfig = l2dData.find(c => c.id === charId)
    currentGaugeupFlag = charConfig?.timing?.gaugeupFlag || ''
    currentAudioMode = charConfig?.timing?.audioMode || ''
    customGaugeupMode = charConfig?.timing?.customGaugeup || false
    
    spinePlayer.animationState.setAnimation(0, 'aim_hit', true) // true = loop
    return
  }

  // Skillcut pose - play skillcut animation
  if (market.live2d.current_pose === 'skillcut') {
    // Check if skillcut animation exists
    const animations = spinePlayer.animationState.data.skeletonData.animations
    let skillcutAnimation = ''
    let animationCandidates = []

    // Determine what idle animation is currently playing
    let currentIdleAnimation = 'idle'
    const overrideConfig = skillcutAnimationOverrides[market.live2d.current_id]

    if (overrideConfig) {
      if (typeof overrideConfig === 'string') {
        // Simple string format (backward compatible)
        currentIdleAnimation = overrideConfig
      } else if (typeof overrideConfig === 'object') {
        // Check if the main skeleton is currently playing one of the configured idles
        const mainAnimEntry = spinePlayer?.animationState?.getCurrent(0)
        const currentAnim = mainAnimEntry?.animation?.name

        // Look for a matching idle in the config
        for (const [idleName, idleValue] of Object.entries(overrideConfig)) {
          // idleValue should be a string, cast it
          const idleStr = idleValue as string
          if (currentAnim === idleStr || currentAnim === idleName) {
            currentIdleAnimation = idleStr
            console.debug(`[Skillcut] Matched ${currentAnim} to idle: ${currentIdleAnimation}`)
            break
          }
        }
        // If no match found, try to use the first available idle from config
        if (currentIdleAnimation === 'idle') {
          const firstEntry = Object.entries(overrideConfig)[0]
          if (firstEntry) {
            currentIdleAnimation = firstEntry[1] as string
            console.debug(`[Skillcut] No match found, using first idle: ${currentIdleAnimation}`)
          }
        }
      }
    }

    // Debug: log current idle for this character
    console.debug(`[Skillcut] ${market.live2d.current_id} - Current idle: ${currentIdleAnimation}`)

    // Check if character has custom skillcut config
    const charConfig = skillcutConfig[market.live2d.current_id]
    if (charConfig) {
      // Check if config has pose-specific animations (e.g., idle_1, idle_2)
      if (charConfig[currentIdleAnimation]) {
        // Use pose-specific animation for this idle
        animationCandidates = charConfig[currentIdleAnimation]
        console.debug(`[Skillcut] Using pose-specific animations: ${animationCandidates.join(', ')}`)
      } else if (charConfig.animations && charConfig.animations.length > 0) {
        // Use default animations for this character
        animationCandidates = charConfig.animations
        console.debug(`[Skillcut] Using default animations: ${animationCandidates.join(', ')}`)
      } else {
        // Default fallback order
        animationCandidates = ['skillcut_all', 'skillcut_0', 'skillcut_1', 'skill_cut', 'skillcut']
        console.debug(`[Skillcut] Using fallback animations: ${animationCandidates.join(', ')}`)
      }
    } else {
      // Default fallback order
      animationCandidates = ['skillcut_all', 'skillcut_0', 'skillcut_1', 'skill_cut', 'skillcut']
    }

    // Try each animation in the candidates list until one is found
    for (const candidate of animationCandidates) {
      const hasSkillcut = animations.some((a: { name: string }) => a.name === candidate)
      if (hasSkillcut) {
        skillcutAnimation = candidate
        break
      }
    }

    if (!skillcutAnimation) {
      // No skillcut animation found, fallback to action
      handleAction()
      return
    }

    // Use the idle animation that was playing before skillcut
    let idleAnimation = currentIdleAnimation
    // Play the skillcut animation then loop back to idle
    spinePlayer.animationState.setAnimation(0, skillcutAnimation, false)
    spinePlayer.animationState.addAnimation(0, idleAnimation, true, 0)
    
    // Force reset all dual-layer animations when starting skillcut
    if (dualLayerInstance?.layers && Array.isArray(dualLayerInstance.layers)) {
      dualLayerInstance.layers.forEach((layer: any) => {
        if (!layer || !layer.state || !layer.config) return
        
        const { config, state } = layer
        if (config.skillcut) {
          try {
            // Clear and play the skillcut animation for this layer
            state.clearTracks()
            state.setAnimation(0, config.skillcut, false)
            // Queue return to idle after skillcut finishes
            if (config.idle) {
              state.addAnimation(0, config.idle, true, 0)
            }
          } catch (e) {
            console.warn('Failed to reset dual layer:', e)
          }
        }
      })
    }
    
    playVoice()
    return
  }

  handleAction()
}

// Handle mouse release - show cover again and play reload
const handleActionEnd = async () => {
  if (!isAimHolding) {
    return
  }

  isAimHolding = false
  
  // Stop any aim sounds immediately when releasing
  stopAimSounds()
  
  // Play fire_echo if in ramping audio mode
  if (currentAudioMode === 'm') {
    const charId = market.live2d.current_id
    const baseCharacterId = charId.split('_')[0]
    const echoPath = `/assets/l2d/${charId}/voice/fx/${charId}_fire_echo.ogg`
    const echoFallback = baseCharacterId !== charId 
      ? `/assets/l2d/${baseCharacterId}/voice/fx/${baseCharacterId}_fire_echo.ogg`
      : echoPath
    
    const echoAudio = new Audio()
    echoAudio.volume = 0.5
    echoAudio.src = baseCharacterId !== charId ? echoFallback : echoPath
    echoAudio.play().catch((err) => {
    })
  }
  
  // Cancel any pending aim skeleton switch
  if (pendingSwitchTimeout) {
    clearTimeout(pendingSwitchTimeout)
    pendingSwitchTimeout = null
  }

  if (market.live2d.current_pose === 'cover') {
    
    // Get aim overlay if it exists
    const aimOverlay = overlayInstances.find((o) => o.source.includes('aim'))
    
    if (aimOverlay) {
      // Play to_cover on aim skeleton first
      const aimAnimations = aimOverlay.state.data.skeletonData.animations
      const hasToCover = aimAnimations.some((a: any) => a.name === 'to_cover')
      
      if (hasToCover) {
        // Get to_cover duration
        const toCoverAnimation = aimAnimations.find((a: any) => a.name === 'to_cover')
        const toCoverDuration = toCoverAnimation?.duration || 0.5
        
        aimOverlay.state.setAnimation(0, 'to_cover', false)
        
        // After to_cover completes on aim, switch back to cover spine
        setTimeout(() => {
          
          // Hide aim overlay
          aimOverlay.skeleton.scaleX = 0
          aimOverlay.skeleton.scaleY = 0
          
          // Clear overlay instances
          overlayInstances = []
          
          // Show cover skeleton again
          if (spinePlayer) {
            spinePlayer.skeleton.scaleX = 1
            spinePlayer.skeleton.scaleY = 1
            
            // Play animation sequence: to_cover -> cover_reload -> cover_idle
            const coverAnimations = spinePlayer.animationState.data.skeletonData.animations
            const hasCoverToCover = coverAnimations.some((a: { name: string }) => a.name === 'to_cover')
            const hasCoverReload = coverAnimations.some((a: { name: string }) => a.name === 'cover_reload')
            
            if (hasCoverToCover) {
              spinePlayer.animationState.setAnimation(0, 'to_cover', false)
              spinePlayer.animationState.addAnimation(0, 'cover_reload', false, 0)
              spinePlayer.animationState.addAnimation(0, 'cover_idle', true, 0)
              playVoice()
            } else if (hasCoverReload) {
              spinePlayer.animationState.setAnimation(0, 'cover_reload', false)
              spinePlayer.animationState.addAnimation(0, 'cover_idle', true, 0)
              playVoice()
            } else {
              spinePlayer.animationState.setAnimation(0, 'cover_idle', true)
            }
          }
        }, toCoverDuration * 1000)
      } else {
        // Fallback: no to_cover, just switch back
        aimOverlay.skeleton.scaleX = 0
        aimOverlay.skeleton.scaleY = 0
        overlayInstances = []
        
        if (spinePlayer) {
          spinePlayer.skeleton.scaleX = 1
          spinePlayer.skeleton.scaleY = 1
          
          const coverAnimations = spinePlayer.animationState.data.skeletonData.animations
          const hasCoverReload = coverAnimations.some((a: { name: string }) => a.name === 'cover_reload')
          
          if (hasCoverReload) {
            spinePlayer.animationState.setAnimation(0, 'cover_reload', false)
            spinePlayer.animationState.addAnimation(0, 'cover_idle', true, 0)
            playVoice()
          } else {
            spinePlayer.animationState.setAnimation(0, 'cover_idle', true)
          }
        }
      }
    } else {
      // No aim overlay found, just play cover sequence
      
      if (spinePlayer) {
        spinePlayer.skeleton.scaleX = 1
        spinePlayer.skeleton.scaleY = 1
        
        const coverAnimations = spinePlayer.animationState.data.skeletonData.animations
        const hasCoverReload = coverAnimations.some((a: { name: string }) => a.name === 'cover_reload')
        
        if (hasCoverReload) {
          spinePlayer.animationState.setAnimation(0, 'cover_reload', false)
          spinePlayer.animationState.addAnimation(0, 'cover_idle', true, 0)
          playVoice()
        } else {
          spinePlayer.animationState.setAnimation(0, 'cover_idle', true)
        }
      }
    }
  }
}

// Track cover hit voice sequence
let coverHitDamageIndex = 1  // Which damage voice to play next (1-3)

// Handle middle-click (button 1) for cover_hit motion in cover mode
const handleCoverHit = async (e?: MouseEvent) => {
  if (!spinePlayer || !canvas || market.live2d.current_pose !== 'cover') return

  const target = e?.target as HTMLElement
  if (!target) return

  // Only trigger on canvas
  const isOnCanvas = target === canvas || canvas.contains(target)
  if (!isOnCanvas) return

  // Check if clicking is over UI panels
  const isUiPanel = target.closest('#l2dsearchbox') || target.closest('.toolList')
  if (isUiPanel) return

  try {
    // Check if cover_hit animation exists
    const animations = spinePlayer.animationState.data.skeletonData.animations
    const hasCoverHit = animations.some((a: { name: string }) => a.name === 'cover_hit')

    if (!hasCoverHit) {
      return
    }

    // Play cover_hit animation, then return to cover_idle
    spinePlayer.animationState.setAnimation(0, 'cover_hit', false)
    spinePlayer.animationState.addAnimation(0, 'cover_idle', true, 0)
    
    // Play damage voice sequence (Damage_1, Damage_2, Damage_3, then repeat)
    playDamageVoice()
  } catch (error) {
    console.error('❌ Error in cover hit:', error)
  }
}

const playDamageVoice = () => {
  // Stop only the previous damage voice if it's playing
  if (currentDamageVoiceAudio) {
    currentDamageVoiceAudio.pause()
    currentDamageVoiceAudio.currentTime = 0
    currentDamageVoiceAudio = null
  }
  
  // Stop current reload sound that's playing
  if (currentReloadSound) {
    currentReloadSound.pause()
    currentReloadSound.currentTime = 0
    currentReloadSound = null
  }
  
  // Stop main voice (reload voice)
  if (currentVoice) {
    currentVoice.pause()
    currentVoice.currentTime = 0
    currentVoice = null
  }
  
  // Stop reload FX timeouts
  shouldStopReloadFx = true
  pendingReloadFxTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
  pendingReloadFxTimeouts = []
  
  const charId = market.live2d.current_id
  const baseCharId = charId.split('_')[0]  // Get base character ID
  
  // Try character-specific damage voice first, then fallback to base character
  const damageVoicePath = `/assets/l2d/${charId}/voice/${charId}_Damage_${coverHitDamageIndex}.ogg`
  const fallbackDamageVoicePath = `/assets/l2d/${baseCharId}/voice/${baseCharId}_Damage_${coverHitDamageIndex}.ogg`
  
  const audio = new Audio()
  audio.volume = 0.7
  currentDamageVoiceAudio = audio
  
  // Try loading character-specific first
  const tryLoadDamageVoice = (path: string, isFallback: boolean) => {
    fetch(path, { method: 'HEAD' })
      .then((response) => {
        if (response.ok) {
          audio.src = path
          audio.play().catch((err) => {
          })
        } else if (!isFallback) {
          // Try fallback if character-specific not found
          tryLoadDamageVoice(fallbackDamageVoicePath, true)
        } else {
        }
      })
      .catch((err) => {
        if (!isFallback) {
          tryLoadDamageVoice(fallbackDamageVoicePath, true)
        }
      })
  }
  
  tryLoadDamageVoice(damageVoicePath, false)
  
  // Move to next damage voice (cycle 1 → 2 → 3 → 1)
  coverHitDamageIndex++
  if (coverHitDamageIndex > 3) {
    coverHitDamageIndex = 1
  }
}

// Swap to aim spine with aim_hit animation ready to play on hold
const swapToCoverAimSpine = async () => {
  
  if (!spinePlayer || !canvas) {
    return
  }

  try {
    // Dispose of current spine player first
    if (spinePlayer?.canvas?.dispose) {
      spinePlayer.canvas.dispose()
    }
    spinePlayer = null
    
    // Load aim spine data for this character
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

    // Create aim player with aim_hit animation
    return new Promise((resolve, reject) => {
      try {
        const aimPlayer = new usedSpine.SpinePlayer('player-container', {
          skelUrl: market.live2d.current_id + '_aim',
          rawDataURIs: {
            [market.live2d.current_id + '_aim']: aimData.skelURL
          },
          atlasUrl: getPathing('atlas', 'aim'),
          animation: '',  // Empty animation - don't try to play any animation on init
          skin: 'default',
          backgroundColor: '#00000000',
          alpha: true,
          premultipliedAlpha: true,
          mipmaps: false,
          debug: true,  // Enable debug to see more info
          preserveDrawingBuffer: true,
          viewport: getSpineViewport('cover'),
          scale: spineScale,
          defaultMix: SPINE_DEFAULT_MIX,
          success: (player: any) => {
            aimSpinePlayer = player
            spinePlayer = player
            
            // Play aim_hit animation while holding
            if (isAimHolding) {
              const animations = player.animationState.data.skeletonData.animations
              const hasAimHit = animations.some((a: { name: string }) => a.name === 'aim_hit')
              
              if (hasAimHit) {
                player.animationState.setAnimation(0, 'aim_hit', true) // true = loop while holding
                playVoice()
              } else {
                // List available animations
                const availableAnims = animations.map((a: { name: string }) => a.name)
              }
            } else {
            }
            
            resolve(player)
          },
          error: (error: any) => {
            console.error('❌ Failed to load aim spine - error:', error)
            console.error('❌ SpinePlayer config:', aimPlayer.config)
            reject(error)
          }
        })
      } catch (error) {
        console.error('❌ Error creating SpinePlayer:', error)
        reject(error)
      }
    })
  } catch (error) {
    console.warn('❌ Aim spine not available:', error)
    throw error
  }
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

// Stop aim sounds (gaugeup only - let fire play to completion)
let currentAimGaugeUpAudio: HTMLAudioElement | null = null
let allAimGaugeUpAudios: HTMLAudioElement[] = []  // Track all gaugeup audio instances
let currentAimFireAudio: HTMLAudioElement | null = null
let currentReloadFxAudio: HTMLAudioElement | null = null  // Track reload fx to stop if clicked again
let isGaugeUpStopped = false  // Track if gaugeup was manually stopped
let currentDamageVoiceAudio: HTMLAudioElement | null = null  // Separate channel for damage voice

const stopAimSounds = () => {
  
  // Stop Web Audio source if it exists
  if (currentWebAudioSource) {
    try {
      currentWebAudioSource.stop()
    } catch (err) {
    }
    currentWebAudioSource = null
  }
  
  // Stop ALL gaugeup sounds immediately and completely
  if (currentAimGaugeUpAudio) {
    currentAimGaugeUpAudio.pause()
    currentAimGaugeUpAudio.currentTime = 0
    currentAimGaugeUpAudio.src = ''  // Clear source completely
    currentAimGaugeUpAudio.load()  // Force reload to clear buffer
    currentAimGaugeUpAudio = null
  }
  
  // Also stop any other active gaugeup audio instances
  allAimGaugeUpAudios.forEach((audio) => {
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      audio.src = ''
      audio.load()
    }
  })
  allAimGaugeUpAudios = []
  
  isGaugeUpStopped = true  // Mark gaugeup as stopped
  // Let fire sound play to completion - don't stop it
  
  // Stop reload FX if it's playing (when user releases during reload)
  // Voice will continue to play
  stopReloadFxOnly()
}

const playAimGaugeUpSound = (characterId: string, gaugeupFlag: string = '', onComplete?: () => void) => {
  // If custom gaugeup mode (s flag), play custom character gaugeup only
  if (customGaugeupMode) {
    const customGaugeUpPath = `/assets/l2d/${characterId}/voice/fx/${characterId}_gaugeup.ogg`
    const audio = new Audio()
    audio.volume = 0.5
    audio.src = customGaugeUpPath
    currentAimGaugeUpAudio = audio
    allAimGaugeUpAudios.push(audio)
    
    audio.onloadeddata = () => {
      audio.play().catch((err) => {
      })
    }
    
    audio.onended = () => {
      currentAimGaugeUpAudio = null
      if (onComplete) onComplete()
    }
    
    // Safety timeout
    setTimeout(() => {
      if (currentAimGaugeUpAudio === audio) {
        currentAimGaugeUpAudio = null
        if (onComplete) onComplete()
      }
    }, 3000)
    
    audio.load()
    return
  }
  
  // Original behavior for r/e flags or no flag
  // First check if character has custom gaugeup in their fx folder
  const customGaugeUpPath = `/assets/l2d/${characterId}/voice/fx/${characterId}_gaugeup.ogg`
  
  // Try custom first, fall back to generic gaugeup sequence (1 then 2)
  const audio1 = new Audio()
  audio1.volume = 0.5
  
  const tryCustomThenGeneric = () => {
    audio1.src = customGaugeUpPath
    
    audio1.onloadeddata = () => {
      currentAimGaugeUpAudio = audio1
      audio1.play().then(() => {
      }).catch((err) => {
        // If custom fails to play, fall back to generic sequence
        currentAimGaugeUpAudio = null
        playGenericGaugeUpSequence()
      })
      
      // Call completion callback when custom gaugeup ends
      audio1.onended = () => {
        currentAimGaugeUpAudio = null
        if (onComplete) onComplete()
      }
      
      // Safety timeout in case onended doesn't fire
      // Assume custom gaugeup is around 2-3 seconds
      setTimeout(() => {
        if (currentAimGaugeUpAudio === audio1) {
          currentAimGaugeUpAudio = null
          if (onComplete) onComplete()
        }
      }, 3000)
    }
    audio1.onerror = () => {
      // Custom not found, play generic sequence
      playGenericGaugeUpSequence()
    }
    audio1.load()
  }
  
  const playGenericGaugeUpSequence = () => {
    // Determine first sound based on gaugeupFlag
    // r or empty = gaugeup_1 (default)
    // e = gaugeup_2
    const gaugeupStartFile = (gaugeupFlag === 'e') ? 'gaugeup_2' : 'gaugeup_1'
    
    // Play first gaugeup sound
    const audio1 = new Audio()
    audio1.volume = 0.5
    audio1.src = `/assets/l2d/_/${gaugeupStartFile}.ogg`
    currentAimGaugeUpAudio = audio1
    allAimGaugeUpAudios.push(audio1)  // Track this instance
    isGaugeUpStopped = false  // Reset stopped flag when starting sequence
    audio1.play().catch(() => {})
    
    // Then play gaugeup_max after first sound ends
    audio1.onended = () => {
      // Check if gaugeup was manually stopped (released click)
      if (isGaugeUpStopped) {
        return
      }
      const audio2 = new Audio()
      audio2.volume = 0.5
      audio2.src = `/assets/l2d/_/gaugeup_max.ogg`
      currentAimGaugeUpAudio = audio2
      allAimGaugeUpAudios.push(audio2)  // Track this instance
      audio2.play().catch(() => {})
      
      // Call completion callback after gaugeup_max ends
      audio2.onended = () => {
        currentAimGaugeUpAudio = null
        if (onComplete) onComplete()
      }
    }
  }
  
  tryCustomThenGeneric()
}

const playRampingAnimationSequence = (aimState: any, targetAnim: string, loopDuration: number) => {
  // Sync animation with audio ramping timings
  const stepSize = 0.1
  
  // Calculate animation restart timings to match audio
  let cumulativeTime = 0
  let waitTime = loopDuration
  
  while (waitTime > 0) {
    // Restart animation at each timing point
    const timing = cumulativeTime
    const timeout = setTimeout(() => {
      if (!isAimHolding) return
      aimState.setAnimation(0, targetAnim, false)
    }, timing)
    
    rampingFireTimeouts.push(timeout)
    cumulativeTime += waitTime * 1000
    waitTime -= stepSize
  }
  
  // After ramping finishes, start continuous loop based on animDuration
  const loopStartTime = cumulativeTime  // Start right after last ramping fire (1400ms)
  
  // Get animation duration to know how often to restart
  const targetAnimObj = aimState.data.skeletonData.animations.find((a: any) => a.name === targetAnim)
  const animDuration = targetAnimObj?.duration || 0.3  // Default ~300ms per loop
  
  let loopAnimTimeout: NodeJS.Timeout | null = null
  const loopAnimation = () => {
    if (!isAimHolding) {
      if (loopAnimTimeout) clearTimeout(loopAnimTimeout)
      return
    }
    
    aimState.setAnimation(0, targetAnim, false)
    loopAnimTimeout = setTimeout(loopAnimation, animDuration * 1000)
  }
  
  const loopStartTimeout = setTimeout(loopAnimation, loopStartTime)
  rampingFireTimeouts.push(loopStartTimeout)
}

const playRampingFireSequence = (characterId: string, animationType: string, loopDuration: number = 1) => {
  // Audio ramping mode: play fire at decreasing intervals based on loopDuration
  // Overlaps with spin sound at the start, then switches to loop
  
  const baseCharacterId = characterId.split('_')[0]
  
  // Play spin sound at start (overlaps with first fire)
  const spinPath = `/assets/l2d/${characterId}/voice/fx/${characterId}_fire_spin.ogg`
  const spinFallback = baseCharacterId !== characterId 
    ? `/assets/l2d/${baseCharacterId}/voice/fx/${baseCharacterId}_fire_spin.ogg`
    : spinPath
  
  const spinAudio = new Audio()
  spinAudio.volume = 0.5
  spinAudio.src = baseCharacterId !== characterId ? spinFallback : spinPath
  spinAudio.play().catch((err) => {
  })
  
  // Ramping fire timings: fires play at decreasing wait intervals
  // Step size determines the speed of ramping (0.1 = 0.5 > 0.4 > 0.3 > 0.2 > 0.1)
  const stepSize = 0.1
  
  // Calculate fires until wait time reaches 0
  const rampTimings: number[] = []
  let cumulativeTime = 0
  let waitTime = loopDuration
  
  while (waitTime > 0) {
    rampTimings.push(cumulativeTime)
    cumulativeTime += waitTime * 1000  // Convert to ms
    waitTime -= stepSize
  }
  
  // After last fire (fire 5), add fire 6 playing 5 times sequentially with 50ms spacing
  // Fire 6 at 1400ms, 1450ms, 1500ms, 1550ms, 1600ms
  const fire6StartTiming = cumulativeTime  // Start right after fire 5
  const fire6Interval = 50  // 50ms between each fire 6
  
  for (let i = 0; i < 5; i++) {
    rampTimings.push(fire6StartTiming + (i * fire6Interval))
  }
  
  // Total ramping duration (when to start fire_loop) - at the same time as last fire 6
  const totalRampingDuration = fire6StartTiming + (4 * fire6Interval)  // Same time as fire 6 #5 (1600ms)
  
  rampingFireTimeouts = []  // Clear any previous timeouts
  
  rampTimings.forEach((timing, index) => {
    const timeout = setTimeout(() => {
      if (!isAimHolding) return
      
      const fireAudio = new Audio()
      fireAudio.volume = 0.5
      const firePath = `/assets/l2d/${characterId}/voice/fx/${characterId}_fire.ogg`
      const fireFallback = baseCharacterId !== characterId 
        ? `/assets/l2d/${baseCharacterId}/voice/fx/${baseCharacterId}_fire.ogg`
        : firePath
      
      fireAudio.src = baseCharacterId !== characterId ? fireFallback : firePath
      fireAudio.play().catch((err) => {
      })
      const waitValue = loopDuration - (index * stepSize)
    }, timing)
    
    rampingFireTimeouts.push(timeout)
  })
  
  // After ramping finishes, switch to fire_loop
  const loopStartTimeout = setTimeout(() => {
    if (!isAimHolding) return
    
    const loopPath = `/assets/l2d/${characterId}/voice/fx/${characterId}_fire_loop.ogg`
    const loopFallback = baseCharacterId !== characterId 
      ? `/assets/l2d/${baseCharacterId}/voice/fx/${baseCharacterId}_fire_loop.ogg`
      : loopPath
    
    // Fetch and decode the audio file once
    fetch(baseCharacterId !== characterId ? loopFallback : loopPath)
      .then(response => response.arrayBuffer())
      .then(arrayBuffer => {
        // Create Web Audio context
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        
        // Decode the audio
        audioContext.decodeAudioData(arrayBuffer, (audioBuffer) => {
          
          // Create a BufferSource that will loop
          const playFireLoopWithWebAudio = () => {
            if (!isAimHolding) return
            
            const source = audioContext.createBufferSource()
            const gainNode = audioContext.createGain()
            
            source.buffer = audioBuffer
            source.loop = true
            source.loopStart = 0
            source.loopEnd = audioBuffer.duration
            
            gainNode.gain.value = 0.5  // volume
            
            source.connect(gainNode)
            gainNode.connect(audioContext.destination)
            
            source.start(0)
            
            // Store for stopping on release
            currentWebAudioSource = source
          }
          
          playFireLoopWithWebAudio()
        }, (error) => {
          // Fallback to HTML5 Audio if Web Audio fails
          const loopAudio = new Audio()
          loopAudio.volume = 0.5
          loopAudio.loop = true
          loopAudio.src = baseCharacterId !== characterId ? loopFallback : loopPath
          currentAimFireAudio = loopAudio
          loopAudio.play().catch((err) => {
          })
        })
      })
      .catch((err) => {
      })
  }, totalRampingDuration)
  
  rampingFireTimeouts.push(loopStartTimeout)
}

const playAimFireSound = (characterId: string, animationType: string) => {
  // Voice is always "fire", regardless of animation type (aim_hit vs aim_fire)
  const baseCharacterId = characterId.split('_')[0]
  const primaryPath = `/assets/l2d/${characterId}/voice/fx/${characterId}_fire.ogg`
  const fallbackPath = baseCharacterId !== characterId 
    ? `/assets/l2d/${baseCharacterId}/voice/fx/${baseCharacterId}_fire.ogg`
    : primaryPath
  
  const audio = new Audio()
  audio.volume = 0.5
  currentAimFireAudio = audio
  
  // For variants, default to fallback (base character fire sound)
  // This way it plays base fire sound unless variant has its own
  const soundPath = baseCharacterId !== characterId ? fallbackPath : primaryPath
  
  audio.src = soundPath
  audio.play().catch((err) => {
  })
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

  // ALWAYS stop the old voice immediately to prevent overlapping audio
  if (currentVoice) {
    currentVoice.pause()
    currentVoice.currentTime = 0
    currentVoice = null
  }

  // Try to play this voice
  if (voice) {
    currentVoice = new Audio(voice)
    activeAudioObjects.push(currentVoice) // Track all audio objects
    currentVoice.addEventListener(
      'error',
      () => {
        voiceExistsCache.set(voice, false)
        console.debug(`Voice file not found: ${voice}`)
        // On error, try the next voice
        playVoiceWithRetry(characterId, pose, attemptCount + 1)
      },
      { once: true }
    )

    currentVoice.addEventListener(
      'canplay',
      () => {
        voiceExistsCache.set(voice, true)
      },
      { once: true }
    )

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
    playSkillcutSound().catch((err) => console.error('Error playing skillcut sound:', err))
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
  // Cancel all pending timeouts that would continue playing sounds
  pendingReloadTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
  pendingReloadTimeouts = []

  pendingActionTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
  pendingActionTimeouts = []

  // Stop main voice
  if (currentVoice) {
    currentVoice.pause()
    currentVoice.currentTime = 0
    currentVoice = null
  }

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

const stopReloadFxOnly = () => {
  // Only stop FX timeouts and current FX audio, let voice continue
  shouldStopReloadFx = true  // Prevent new FX from starting
  
  pendingReloadFxTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
  pendingReloadFxTimeouts = []
  
  // Clear ramping fire timeouts
  if (rampingFireTimeouts.length > 0) {
    rampingFireTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
    rampingFireTimeouts = []
  }

  // Stop current reload FX audio - completely remove it
  if (currentReloadFxAudio) {
    currentReloadFxAudio.pause()
    currentReloadFxAudio.currentTime = 0
    currentReloadFxAudio.src = ''  // Clear source completely
    currentReloadFxAudio = null
  }
  
  // Also check currentReloadSound in case it's an FX file
  if (currentReloadSound && currentReloadSound.src && currentReloadSound.src.includes('/fx/')) {
    currentReloadSound.pause()
    currentReloadSound.currentTime = 0
    currentReloadSound.src = ''  // Clear source completely
    currentReloadSound = null
  }
  
  // Stop fire sound loop timer when clicking
  if (currentFireLoopTimer) {
    clearTimeout(currentFireLoopTimer)
    currentFireLoopTimer = null
  }
  
  // Also stop fire sound when clicking (fire FX should stop)
  if (currentAimFireAudio) {
    currentAimFireAudio.pause()
    currentAimFireAudio.currentTime = 0
    currentAimFireAudio.src = ''
    currentAimFireAudio = null
  }
}

const playReloadSound = () => {
  // Get base character ID for reload sound (always stored in base folder)
  // e.g., 'c271_01' -> 'c271'
  const baseCharacterId = market.live2d.current_id.split('_')[0]

  // Track which character this reload sound belongs to
  reloadSoundCharacterId = baseCharacterId
  
  // Reset the stop flag when starting new reload
  shouldStopReloadFx = false

  // Reset to start of sequence when new reload sound starts
  reloadSoundIndex = 1
  playNextReloadSound(baseCharacterId)
}

const playNextReloadSound = (baseCharacterId: string) => {
  // Stop if user clicked during reload (FX should be stopped)
  if (shouldStopReloadFx) {
    return
  }
  
  // Stop if this sound sequence belongs to a different character (user switched)
  if (reloadSoundCharacterId !== baseCharacterId) {
    return
  }

  // Check if we've reached the end of the sequence (1-6)
  if (reloadSoundIndex > 6) {
    return
  }

  // Construct reload sound path
  const reloadSoundPath = `/assets/l2d/${baseCharacterId}/voice/fx/${baseCharacterId}_reload_${reloadSoundIndex}.ogg`

  // Get config for this character and reload number
  const characterConfig = reloadSoundConfig[baseCharacterId]
  const soundConfig = characterConfig?.[reloadSoundIndex] || {}

  let eventHandled = false

  const moveToNext = () => {
    if (!eventHandled) {
      eventHandled = true
      reloadSoundIndex++
      const timeoutId = setTimeout(() => playNextReloadSound(baseCharacterId), 50)
      pendingReloadFxTimeouts.push(timeoutId)  // Use FX timeouts, not voice timeouts
    }
  }

  const tryPlayReload = (soundPath: string) => {
    // Check if file exists first (HEAD request, no logging)
    fetch(soundPath, { method: 'HEAD' })
      .then((response) => {
        if (!response.ok) {
          // File doesn't exist, skip to next
          moveToNext()
          return
        }

        // File exists, proceed with playback
        currentReloadSound = new Audio(soundPath)
        currentReloadFxAudio = currentReloadSound  // Also track for stopping on click
        activeAudioObjects.push(currentReloadSound) // Track all audio objects

        // Set up trim if configured
        if (soundConfig.trimMs) {
          currentReloadSound.addEventListener(
            'canplay',
            () => {
              setTimeout(() => {
                if (currentReloadSound && currentReloadSound.currentTime >= 0) {
                  currentReloadSound.pause()
                  moveToNext()
                }
              }, soundConfig.trimMs)
            },
            { once: true }
          )
        }

        currentReloadSound.addEventListener(
          'error',
          () => {
            moveToNext()
          },
          { once: true }
        )

        // Set a timeout in case it fails to load
        const timeoutId = setTimeout(() => {
          moveToNext()
        }, 2000)

        // Handle overlap - wait for metadata to get duration
        if (soundConfig.overlapMs || soundConfig.overlap) {
          currentReloadSound.addEventListener(
            'loadedmetadata',
            () => {
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
              const timeoutId = setTimeout(() => {
                // Check if character changed or sequence was cancelled
                if (!eventHandled && reloadSoundCharacterId === baseCharacterId) {
                  reloadSoundIndex++
                  playNextReloadSound(baseCharacterId)
                }
              }, overlapStart)
              pendingReloadFxTimeouts.push(timeoutId)  // Use FX timeouts, not voice timeouts
            },
            { once: true }
          )
        } else {
          // Only add 'ended' listener if NOT using overlap
          currentReloadSound.addEventListener(
            'ended',
            () => {
              moveToNext()
            },
            { once: true }
          )
        }

        // Play with delay if configured
        const playWithDelay = () => {
          currentReloadSound
            .play()
            .then(() => {
              clearTimeout(timeoutId)
            })
            .catch(() => {
              clearTimeout(timeoutId)
              moveToNext()
            })
        }

        if (soundConfig.delay) {
          // Auto multiply by 100 to convert to milliseconds (e.g., 3 -> 300ms)
          setTimeout(playWithDelay, soundConfig.delay * 100)
        } else {
          playWithDelay()
        }
      })
      .catch(() => {
        // Network error, skip to next
        moveToNext()
      })
  }

  // Start with primary path
  tryPlayReload(reloadSoundPath)
}

const playActionSound = () => {
  // Track which character this action sound belongs to
  actionSoundCharacterId = market.live2d.current_id

  // Reset to start of sequence when new action sound starts
  actionSoundIndex = 1
  playNextActionSound()
}

const playNextActionSound = (pathAttempt = 0) => {
  // Stop if this sound sequence belongs to a different character (user switched)
  if (actionSoundCharacterId !== market.live2d.current_id) {
    return
  }

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
  soundPaths.push(`/assets/l2d/${market.live2d.current_id}/voice/fx/${market.live2d.current_id}_action_${actionSoundIndex}.ogg`)
  if (!isVariant) {
    soundPaths.push(`/assets/l2d/${market.live2d.current_id}/voice/fx/${market.live2d.current_id}_00_action_${actionSoundIndex}.ogg`)
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
  activeAudioObjects.push(currentActionSound) // Track all audio objects

  let eventHandled = false

  const moveToNext = () => {
    if (!eventHandled) {
      eventHandled = true
      actionSoundIndex++
      const timeoutId = setTimeout(() => playNextActionSound(), 50)
      pendingActionTimeouts.push(timeoutId)
    }
  }

  // Set up trim if configured
  if (soundConfig.trimMs) {
    currentActionSound.addEventListener(
      'canplay',
      () => {
        const timeoutId = setTimeout(() => {
          if (currentActionSound && currentActionSound.currentTime >= 0) {
            currentActionSound.pause()
            moveToNext()
          }
        }, soundConfig.trimMs)
        pendingActionTimeouts.push(timeoutId)
      },
      { once: true }
    )
  }

  // Handle overlap - wait for metadata to get duration
  if (soundConfig.overlapMs || soundConfig.overlap) {
    currentActionSound.addEventListener(
      'loadedmetadata',
      () => {
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
        const timeoutId = setTimeout(() => {
          // Check if character changed or sequence was cancelled
          if (!eventHandled && actionSoundCharacterId === market.live2d.current_id) {
            actionSoundIndex++
            playNextActionSound()
          }
        }, overlapStart)
        pendingActionTimeouts.push(timeoutId)
      },
      { once: true }
    )
  } else {
    // Only add 'ended' listener if NOT using overlap
    currentActionSound.addEventListener(
      'ended',
      () => {
        moveToNext()
      },
      { once: true }
    )
  }

  currentActionSound.addEventListener(
    'error',
    () => {
      // Try next path
      playNextActionSound(pathAttempt + 1)
    },
    { once: true }
  )

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

const playSkillcutSound = async () => {
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

  // Helper function to validate that a response is a valid OGG audio file (not HTML)
  const isValidAudioResponse = (response: Response): boolean => {
    // Check if response is ok
    if (!response.ok) {
      return false
    }

    // Check Content-Type header to ensure it's audio (not HTML error page)
    const contentType = response.headers.get('content-type')

    // If content-type is HTML, it's definitely an error page
    if (contentType && contentType.includes('text/html')) {
      return false
    }

    // Valid audio files should have audio/* content type or application/ogg
    if (contentType && (contentType.includes('audio/') || contentType.includes('application/ogg'))) {
      return true
    }

    // If no content-type header, assume it's valid (some servers don't send it)
    // The file extension in the URL (.ogg) is our best indicator
    return true
  }

  // Helper function to get skillcut voice path with fallback (no HEAD checks - instant)
  const getSkillcutVoicePath = (charId: string, soundType: string): string => {
    // First try the character itself
    const selfPath = soundType === 'main' ? `/assets/l2d/${charId}/voice/${charId}_Ult_Skill_1.ogg` : `/assets/l2d/${charId}/voice/fx/${charId}_ult_cutscene.ogg`
    return selfPath
  }

  // Play main sound (Ult_Skill_1) with fallback
  const mainPath = getSkillcutVoicePath(characterId, 'main')

  console.debug(`Playing skillcut main sound: ${mainPath}`)
  currentActionSound = new Audio(mainPath)
  currentActionSound.play().catch(() => {
    console.debug(`Failed to play main skillcut sound: ${mainPath}`)
  })

  // Play overlay sound (ult_cutscene) with fallback
  const overlayPath = getSkillcutVoicePath(characterId, 'overlay')

  console.debug(`Playing skillcut overlay sound: ${overlayPath}`)
  currentSkillcutOverlaySound = new Audio(overlayPath)
  currentSkillcutOverlaySound.play().catch(() => {
    console.debug(`Failed to play overlay skillcut sound: ${overlayPath}`)
  })
}

const SPINE_DEFAULT_MIX = 0.25
let spinePlayer: any = null

// Load dual-layer skeleton (same skeleton rendered twice with different animations)
function loadDualLayerSkeleton() {
  // Dual layers work for any pose, not just skillcut
  if (!spineCanvas?.context || !charactersWithDualLayer[market.live2d.current_id]) {
    dualLayerInstance = null
    return Promise.resolve()
  }

  return new Promise<void>(async (resolve) => {
    try {
      const SpineLib = (window as any).usedSpineGlobal

      if (!SpineLib || !spineCanvas) {
        resolve()
        return
      }

      // Get layers config
      const dualConfig = charactersWithDualLayer[market.live2d.current_id]
      if (!dualConfig?.layers || !Array.isArray(dualConfig.layers) || dualConfig.layers.length === 0) {
        dualLayerInstance = null
        resolve()
        return
      }

      // Determine what animations the layers use
      const firstLayer = dualConfig.layers[0]
      const usesSkillcutAnimations = firstLayer?.skillcut?.includes('skillcut') || 
                                     firstLayer?.skillcut?.includes('_OFF') ||
                                     firstLayer?.skillcut?.includes('_BIG')

      // Skip loading if pose doesn't match layer type
      if (usesSkillcutAnimations && market.live2d.current_pose !== 'skillcut') {
        dualLayerInstance = null
        resolve()
        return
      }
      if (!usesSkillcutAnimations && market.live2d.current_pose === 'skillcut') {
        dualLayerInstance = null
        resolve()
        return
      }

      // Load skeleton once for all layers
      const assetMgr = new SpineLib.AssetManager(spineCanvas.context, '')

      let skelPath = ''
      let atlasPath = ''

      // For dual layers in skillcut mode, just use the already-loaded skillcut skeleton from spineCanvas
      // This ensures we have all the animations the layers need
      if (market.live2d.current_pose === 'skillcut' && usesSkillcutAnimations) {
        // Use current pose's skeleton (already loaded)
        if (spineCanvas.config?.atlasUrl) {
          atlasPath = spineCanvas.config.atlasUrl
          skelPath = atlasPath.replace('.atlas', '.skel')
        }
      } else if (usesSkillcutAnimations) {
        // Load from skillcut skeleton (for FB mode with skillcut animations)
        const charId = market.live2d.current_id
        const baseCharId = charId.split('_')[0]
        skelPath = globalParams.PATH_L2D + charId + '/' + globalParams.PATH_L2D_SKILLCUT + charId + '_00_skillcut.skel'
        atlasPath = globalParams.PATH_L2D + charId + '/' + globalParams.PATH_L2D_SKILLCUT + charId + '_00_skillcut.atlas'
        
        if (charId.includes('_')) {
          skelPath = globalParams.PATH_L2D + baseCharId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharId + '_00_skillcut.skel'
          atlasPath = globalParams.PATH_L2D + baseCharId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharId + '_00_skillcut.atlas'
        }
      } else {
        // Load from current pose's skeleton (already loaded by spineCanvas)
        if (spineCanvas.config?.atlasUrl) {
          atlasPath = spineCanvas.config.atlasUrl
          skelPath = atlasPath.replace('.atlas', '.skel')
        } else {
          console.warn('[DualLayer] Could not determine skeleton path, falling back to skillcut')
          // Fallback to skillcut skeleton if current pose config is missing
          const charId = market.live2d.current_id
          const baseCharId = charId.split('_')[0]
          skelPath = globalParams.PATH_L2D + charId + '/' + globalParams.PATH_L2D_SKILLCUT + charId + '_00_skillcut.skel'
          atlasPath = globalParams.PATH_L2D + charId + '/' + globalParams.PATH_L2D_SKILLCUT + charId + '_00_skillcut.atlas'
          
          if (charId.includes('_')) {
            skelPath = globalParams.PATH_L2D + baseCharId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharId + '_00_skillcut.skel'
            atlasPath = globalParams.PATH_L2D + baseCharId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharId + '_00_skillcut.atlas'
          }
        }
      }

      assetMgr.loadBinary(skelPath)
      assetMgr.loadTextureAtlas(atlasPath)
      await assetMgr.loadAll()

      const binary = assetMgr.require(skelPath)
      const atlas = assetMgr.require(atlasPath)
      const skeletonBinary = new SpineLib.SkeletonBinary(new SpineLib.AtlasAttachmentLoader(atlas))
      const skeletonData = skeletonBinary.readSkeletonData(binary)

      // Create instances for each layer
      const layerInstances = dualConfig.layers.map((layerConfig: any) => {
        const skeleton = new SpineLib.Skeleton(skeletonData)
        const state = new SpineLib.AnimationState(new SpineLib.AnimationStateData(skeletonData))

        // Validate that animations exist
        const idleExists = !layerConfig.idle || skeletonData.animations.some((a: any) => a.name === layerConfig.idle)
        const skillcutExists = !layerConfig.skillcut || skeletonData.animations.some((a: any) => a.name === layerConfig.skillcut)

        if (!idleExists || !skillcutExists) {
          console.warn(`[DualLayer] Layer filtered out: idle="${layerConfig.idle}" (exists=${idleExists}), skillcut="${layerConfig.skillcut}" (exists=${skillcutExists})`)
          return null
        }

        // Set initial idle animation
        if (layerConfig.idle) {
          state.setAnimation(0, layerConfig.idle, true)
        }

        return {
          skeleton: skeleton,
          state: state,
          config: layerConfig
        }
      }).filter((layer: any) => layer !== null)

      if (layerInstances.length === 0) {
        console.warn('[DualLayer] No valid layer instances created for', market.live2d.current_id)
        dualLayerInstance = null
        resolve()
        return
      }

      dualLayerInstance = {
        layers: layerInstances,
        skeletonData: skeletonData
      }

      resolve()
    } catch (error) {
      console.warn('Failed to load dual-layer skeleton:', error)
      dualLayerInstance = null
      resolve()
    }
  })
}

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
      // In cover mode: only load aim overlay, skip bg/fg
      // In other poses: only load bg/fg if character is in the list
      const isInOverlayList = charactersWithFgBgOverlays.includes(characterId)
      const isCoverMode = market.live2d.current_pose === 'cover'
      
      // Skip if: (not cover mode AND not in list) OR (cover mode with no characters to support)
      if (!isInOverlayList && !isCoverMode) {
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
      const tryLoadOverlay = async (overlayType: 'bg' | 'fg' | 'aim'): Promise<boolean> => {
        // In cover mode, skip bg/fg overlays entirely - only load aim
        if (isCoverMode && (overlayType === 'bg' || overlayType === 'fg')) {
          return false
        }
        
        // Determine suffix for overlays based on character ID pattern
        // Characters with _01, _02, etc don't have _00 suffix for overlays
        // Characters without variant suffix use _00 for overlays
        const hasVariant = /_\d{2}$/.test(characterId)
        const overlaySuffix = hasVariant ? '' : mainSuffix

        // For aim overlay, check the subfolder first
        let pathPatterns = []
        
        if (overlayType === 'aim') {
          pathPatterns = [
            // Check aim subfolder with _aim_00 naming
            { skel: `${charFolder}/aim/${characterId}_aim${overlaySuffix}.skel`, atlas: `${charFolder}/aim/${characterId}_aim${overlaySuffix}.atlas` },
            { skel: `${charFolder}/aim/${characterId}_aim_00.skel`, atlas: `${charFolder}/aim/${characterId}_aim_00.atlas` },
            { skel: `${charFolder}/${characterId}_aim.skel`, atlas: `${charFolder}/${characterId}_aim.atlas` }
          ]
        } else {
          pathPatterns = [
            { skel: `${charFolder}/${characterId}${overlaySuffix}_${overlayType}.skel`, atlas: `${charFolder}/${characterId}${overlaySuffix}_${overlayType}.atlas` },
            { skel: `${charFolder}/${characterId}_${overlayType}.skel`, atlas: `${charFolder}/${characterId}_${overlayType}.atlas` }
          ]
        }

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
              } else if (overlayType === 'aim' && animations.includes('aim_idle')) {
                defaultAnim = 'aim_idle'
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
      const bgLoaded = await tryLoadOverlay('bg')

      // Try to load foreground
      const fgLoaded = await tryLoadOverlay('fg')
      
      // Try to load aim overlay (for characters with aim/cover modes in cover pose)
      if (market.live2d.current_pose === 'cover') {
        const aimLoaded = await tryLoadOverlay('aim')
        
        // Hide aim skeleton by default (will be shown on click)
        const aimOverlay = overlayInstances.find((o) => o.source.includes('_aim'))
        if (aimOverlay) {
          aimOverlay.skeleton.scaleX = 0
          aimOverlay.skeleton.scaleY = 0
        }
      }
      
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
  overlayInstances.forEach((overlay) => {
    overlay.state.update(1 / 60)
    overlay.state.apply(overlay.skeleton)
    overlay.skeleton.updateWorldTransform()
  })

  // Update dual-layer animations
  if (dualLayerInstance) {
    dualLayerInstance.state.update(1 / 60)
    dualLayerInstance.state.apply(dualLayerInstance.skeleton)
    dualLayerInstance.skeleton.updateWorldTransform()
  }

  // Get z-index for dual-layer from config array (if provided)
  const dualConfig = charactersWithDualLayer[market.live2d.current_id]
  const hasZIndexInConfig = Array.isArray(dualConfig) && dualConfig.length >= 4
  const dualLayerInFront = hasZIndexInConfig && dualConfig[3] > dualConfig[2]

  // Render dual-layer in front if configured, otherwise back
  if (dualLayerInstance && dualLayerInFront) {
    renderer.begin()
    renderer.drawSkeleton(dualLayerInstance.skeleton, true)
    renderer.end()
  }

  // Render main skeleton
  renderer.begin()
  renderer.drawSkeleton(spineCanvas.skeleton, true)

  // Render overlays (bg first, then fg)
  overlayInstances.forEach((overlay) => {
    renderer.drawSkeleton(overlay.skeleton, true)
  })

  // Render dual-layer in back if configured that way
  if (dualLayerInstance && !dualLayerInFront) {
    renderer.drawSkeleton(dualLayerInstance.skeleton, true)
  }

  renderer.end()
}

// Load spine data for a specific pose
const loadSpineData = (pose: 'aim' | 'cover'): Promise<any> => {
  return new Promise((resolve, reject) => {
    const skelUrl = getPathing('skel', pose)
    const atlasUrl = getPathing('atlas', pose)
    
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
      // Create a blob URL directly from the buffer
      const blob = new Blob([buffer], { type: 'application/octet-stream' })
      const skelURL = URL.createObjectURL(blob)
      
      resolve({
        skelURL: skelURL,
        buffer: buffer
      })
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

// Helper function to validate that a response is a valid skeleton file (binary data, not HTML)
const isValidSkeletonResponse = (request: XMLHttpRequest): boolean => {
  // Check status first
  if (request.status !== 200) {
    return false
  }

  // Check Content-Type header to ensure it's binary data (not HTML error page)
  const contentType = request.getResponseHeader('content-type')

  // If content-type is HTML, it's definitely an error page
  if (contentType && contentType.includes('text/html')) {
    return false
  }

  // Additional validation: check if response buffer looks like a skeleton file
  // Spine skeleton files have a version header in the first 16 bytes
  if (request.response && request.response.byteLength > 16) {
    const uintArray = new Uint8Array(request.response)
    const firstBytes = uintArray.slice(0, 16)
    const versionString = new TextDecoder().decode(firstBytes).replace(/\0/g, '')

    // Skeleton files should have a version like "4.0.xx" or "4.1.xx"
    // If it's HTML content, this will be gibberish or HTML tags
    if (/4\.[01]\.\d+/.test(versionString)) {
      return true
    }
  }

  return false
}

const spineLoader = () => {
  let skelUrl = getPathing('skel')
  const request = new XMLHttpRequest()

  request.responseType = 'arraybuffer'
  request.open('GET', skelUrl, true)
  request.send()
  request.onloadend = () => {
    // If skillcut file not found or invalid, try base character's skillcut
    if (!isValidSkeletonResponse(request) && market.live2d.current_pose === 'skillcut') {
      const characterId = market.live2d.current_id
      const baseCharacterId = characterId.split('_')[0]

      if (baseCharacterId !== characterId) {
        const baseSkelUrl = globalParams.PATH_L2D + baseCharacterId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharacterId + '_00_skillcut.skel'

        const baseRequest = new XMLHttpRequest()
        baseRequest.responseType = 'arraybuffer'
        baseRequest.open('GET', baseSkelUrl, true)
        baseRequest.send()
        baseRequest.onerror = () => {
          console.error('Failed to load base character skillcut: network error')
        }
        baseRequest.onloadend = () => {
          if (isValidSkeletonResponse(baseRequest)) {
            loadSpineWithBuffer(baseRequest.response, baseCharacterId)
          } else {
            console.error('Failed to load base character skillcut:', baseRequest.statusText)
          }
        }
        return
      }
    }

    if (!isValidSkeletonResponse(request)) {
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
      const overrideValue = skillcutAnimationOverrides[market.live2d.current_id]
      // Handle both string and object formats
      if (typeof overrideValue === 'string') {
        initialAnimation = overrideValue
      } else if (typeof overrideValue === 'object') {
        // For object format, use the first idle as initial animation
        const firstEntry = Object.entries(overrideValue)[0]
        if (firstEntry) {
          initialAnimation = firstEntry[1] as string
        }
      }
    }

    spineCanvas = new usedSpine.SpinePlayer('player-container', {
      skelUrl: skelUrlKey,
      rawDataURIs: {
        [skelUrlKey]: skelURL
      },
      atlasUrl: atlasUrl,
      animation: initialAnimation,
      skin: null, // Don't set skin at init; let success callback handle it
      scale: spineScale,
      backgroundColor: '#00000000',
      alpha: true,
      premultipliedAlpha: true,
      mipmaps: market.live2d.current_pose === 'fb' ? true : false,
      debug: false,
      preserveDrawingBuffer: true,
      viewport: getSpineViewport(market.live2d.current_pose),
      defaultMix: SPINE_DEFAULT_MIX,
      success: (player: any) => {
        // Now that skeleton is loaded, try to set the desired skin
        const requestedSkin = market.live2d.getSkin()
        const availableSkins = player.animationState.data.skeletonData.skins

        let skinToUse = requestedSkin

        // Check if requested skin exists
        if (availableSkins && availableSkins.length > 0) {
          const skinNames = availableSkins.map((s: any) => s.name)

          // If requested skin doesn't exist, use first available skin
          if (!skinNames.includes(requestedSkin)) {
            skinToUse = skinNames[0] || 'default'
          }

          // Try to set the skin
          try {
            if (skinToUse && skinToUse !== 'default') {
              player.skeleton.setSkinByName(skinToUse)
            }
          } catch (e) {
            console.warn(`Failed to set skin '${skinToUse}', using first available`)
            // Fallback to first available skin
            try {
              player.skeleton.setSkinByName(skinNames[0])
            } catch (e2) {
              console.warn('Could not set any skin, using default')
            }
          }
        }

        // Now safely get the skin's attachments (use current skin or fallback to defaultSkin)
        const activeSkin = player.skeleton.skin || player.animationState.data.skeletonData.defaultSkin
        if (activeSkin && activeSkin.attachments) {
          activeSkin.attachments.forEach((a: any[]) => {
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
        }

        spinePlayer = player
        market.live2d.attachments = activeSkin && activeSkin.attachments ? activeSkin.attachments : []

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

        // Apply special skins from config
        const skinName = characterSkins[market.live2d.current_id]
        if (skinName) {
          const availableSkins = player.animationState.data.skeletonData.skins
          if (availableSkins && availableSkins.length > 0) {
            const skinNames = availableSkins.map((s: any) => s.name)
            if (skinNames.includes(skinName)) {
              player.skeleton.setSkinByName(skinName)
            }
          }
        }

        // Apply special fullbody skins from config (for fb pose)
        if (market.live2d.current_pose === 'fb') {
          const fullbodySkinName = characterFullbodySkins[market.live2d.current_id]
          if (fullbodySkinName) {
            const availableSkins = player.animationState.data.skeletonData.skins
            if (availableSkins && availableSkins.length > 0) {
              const skinNames = availableSkins.map((s: any) => s.name)
              if (skinNames.includes(fullbodySkinName)) {
                player.skeleton.setSkinByName(fullbodySkinName)
              }
            }
          }
        }

        // Load dual-layer skeleton if this character supports it (works for skillcut pose only)
        if (charactersWithDualLayer[market.live2d.current_id]) {
          loadDualLayerSkeleton().then(() => {
            if (dualLayerInstance) {
              // Set up syncing between main and dual-layer
              const renderer = spineCanvas.sceneRenderer
              const originalDrawSkeleton = renderer.drawSkeleton.bind(renderer)
              const mainSkeleton = spineCanvas.skeleton
              let isRenderingMain = false

              // Get layers config
              const dualConfig = charactersWithDualLayer[market.live2d.current_id]
              
              let lastFrontAnimName = '' // Track last animation to detect changes

              renderer.drawSkeleton = function (skeleton: any, premultipliedAlpha: boolean) {
                if (skeleton === mainSkeleton && !isRenderingMain) {
                  isRenderingMain = true

                  // Get current animation from main skeleton
                  const mainAnimEntry = player?.animationState?.getCurrent(0)
                  const animName = mainAnimEntry?.animation?.name

                  // Sync all layers
                  if (dualLayerInstance && dualLayerInstance.layers) {
                    dualLayerInstance.layers.forEach((layer: any, idx: number) => {
                      const { config, state } = layer

                      // Check if main skeleton is playing ANY skillcut animation (from any layer)
                      const isPlayingAnySkillcut = dualConfig && dualConfig.layers && 
                        dualConfig.layers.some((l: any) => l.skillcut && animName === l.skillcut)

                      // Debug: log once when animation changes
                      if (animName !== lastFrontAnimName) {


                      }

                      // If any layer's skillcut is playing on main skeleton, sync all layers to their skillcuts
                      if (isPlayingAnySkillcut && animName !== lastFrontAnimName && config.skillcut) {
                        state.clearTracks()
                        state.setAnimation(0, config.skillcut, false)
                        // Return to idle after skillcut with a slight delay
                        if (config.idle) {
                          state.addAnimation(0, config.idle, true, 0)
                        }
                      }
                      // Handle idle animation (if not in skillcut mode)
                      else if (!isPlayingAnySkillcut && animName === config.idle && config.idle) {
                        const currentLayerAnim = state.getCurrent(0)?.animation?.name
                        if (currentLayerAnim !== config.idle) {
                          state.setAnimation(0, config.idle, true)
                        }
                      }
                    })
                    lastFrontAnimName = animName || ''
                  }

                  // Render layers sorted by zIndex
                  if (dualLayerInstance && dualLayerInstance.layers) {
                    const sortedLayers = [...dualLayerInstance.layers].sort((a: any, b: any) => a.config.zIndex - b.config.zIndex)
                    
                    // Render layers with lower zIndex first (background), then main skeleton, then higher zIndex (foreground)
                    const mainZIndex = 1000 // Main skeleton rendered in the middle
                    
                    for (const layer of sortedLayers) {
                      if (layer.config.zIndex < mainZIndex) {
                        // Skip rendering if this layer's current animation matches the main skeleton's animation (avoid duplication)
                        const layerCurrentAnim = layer.state.getCurrent(0)?.animation?.name
                        if (layerCurrentAnim === animName) {
                          continue
                        }

                        // Hide shadow attachments on additional layers to avoid double shadow
                        const shadowSlot = layer.skeleton.findSlot('shadow')
                        if (shadowSlot) {
                          shadowSlot.attachment = null
                        }
                        
                        layer.state.update(1 / 60)
                        layer.state.apply(layer.skeleton)
                        layer.skeleton.updateWorldTransform()
                        originalDrawSkeleton(layer.skeleton, premultipliedAlpha)
                      }
                    }
                  }

                  // Render main skeleton
                  originalDrawSkeleton(skeleton, premultipliedAlpha)

                  // Render foreground layers
                  if (dualLayerInstance && dualLayerInstance.layers) {
                    const sortedLayers = [...dualLayerInstance.layers].sort((a: any, b: any) => a.config.zIndex - b.config.zIndex)
                    const mainZIndex = 1000

                    for (const layer of sortedLayers) {
                      if (layer.config.zIndex >= mainZIndex) {
                        // Skip rendering if this layer's current animation matches the main skeleton's animation (avoid duplication)
                        const layerCurrentAnim = layer.state.getCurrent(0)?.animation?.name
                        if (layerCurrentAnim === animName) {
                          continue
                        }

                        // Hide shadow attachments on additional layers to avoid double shadow
                        const shadowSlot = layer.skeleton.findSlot('shadow')
                        if (shadowSlot) {
                          shadowSlot.attachment = null
                        }
                        
                        layer.state.update(1 / 60)
                        layer.state.apply(layer.skeleton)
                        layer.skeleton.updateWorldTransform()
                        originalDrawSkeleton(layer.skeleton, premultipliedAlpha)
                      }
                    }
                  }

                  isRenderingMain = false
                } else if (skeleton !== mainSkeleton) {
                  originalDrawSkeleton(skeleton, premultipliedAlpha)
                }
              }
            }
          })
        }

        // Load overlay skeletons if they exist (bg, fg layers)
        if (market.live2d.current_pose === 'fb' || market.live2d.current_pose === 'cover') {
          // For cover mode, ALWAYS set up overlay rendering (for all characters with aim folder)
          // For fb mode, only set up if character is in the list
          const shouldLoadOverlays = market.live2d.current_pose === 'cover' || 
                                     charactersWithFgBgOverlays.includes(market.live2d.current_id)
          
          if (shouldLoadOverlays) {
            loadOverlaySkeletons().then(() => {
            if (overlayInstances.length > 0) {
              const renderer = spineCanvas.sceneRenderer
              const originalDrawSkeleton = renderer.drawSkeleton.bind(renderer)
              const mainSkeleton = spineCanvas.skeleton // Reference to main skeleton
              let isRenderingMain = false
              let lastMainAnimTime = 0 // Track main animation time to detect restart

              renderer.drawSkeleton = function (skeleton: any, premultipliedAlpha: boolean) {
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
                    const bgOverlay = overlayInstances.find((o) => o.source.includes('_bg'))
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
                    const fgOverlay = overlayInstances.find((o) => o.source.includes('_fg'))
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
                  const bgOverlay = overlayInstances.find((o) => o.source.includes('_bg'))
                  if (bgOverlay) {
                    bgOverlay.state.update(1 / 60)
                    bgOverlay.state.apply(bgOverlay.skeleton)
                    bgOverlay.skeleton.updateWorldTransform()
                    originalDrawSkeleton(bgOverlay.skeleton, premultipliedAlpha)
                  }

                  // Render main skeleton in the middle
                  originalDrawSkeleton(skeleton, premultipliedAlpha)

                  // Render aim overlay (for cover mode aim/fire mechanic)
                  const aimOverlay = overlayInstances.find((o) => o.source.includes('_aim'))
                  if (aimOverlay && aimOverlay.skeleton.scaleX !== 0) {
                    // Keep aim skeleton aligned with cover skeleton during render
                    aimOverlay.skeleton.x = skeleton.x
                    aimOverlay.skeleton.y = skeleton.y
                    
                    aimOverlay.state.update(1 / 60)
                    aimOverlay.state.apply(aimOverlay.skeleton)
                    aimOverlay.skeleton.updateWorldTransform()
                    originalDrawSkeleton(aimOverlay.skeleton, premultipliedAlpha)
                  }

                  // Render foreground last (in front of main)
                  const fgOverlay = overlayInstances.find((o) => o.source.includes('_fg'))
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
          // Don't clear overlays if we have aim overlays (from click-to-aim mechanic)
          const hasAimOverlay = overlayInstances.some((o) => o.source.includes('_aim'))
          if (!hasAimOverlay) {
            overlayInstances = []
          }
        }

        // Load dual-layer skeleton if this character supports it (works for skillcut pose only)
        if (charactersWithDualLayer[market.live2d.current_id]) {
          loadDualLayerSkeleton().then(() => {
            if (dualLayerInstance) {
              // Set up syncing between main and dual-layer
              const renderer = spineCanvas.sceneRenderer
              const originalDrawSkeleton = renderer.drawSkeleton.bind(renderer)
              const mainSkeleton = spineCanvas.skeleton
              let isRenderingMain = false

              // Get layers config
              const dualConfig = charactersWithDualLayer[market.live2d.current_id]
              
              let lastFrontAnimName = '' // Track last animation to detect changes

              renderer.drawSkeleton = function (skeleton: any, premultipliedAlpha: boolean) {
                if (skeleton === mainSkeleton && !isRenderingMain) {
                  isRenderingMain = true

                  // Get current animation from main skeleton
                  const mainAnimEntry = player?.animationState?.getCurrent(0)
                  const animName = mainAnimEntry?.animation?.name

                  // Sync all layers
                  if (dualLayerInstance && dualLayerInstance.layers) {
                    dualLayerInstance.layers.forEach((layer: any, idx: number) => {
                      const { config, state } = layer

                      // Check if main skeleton is playing ANY skillcut animation (from any layer)
                      const isPlayingAnySkillcut = dualConfig && dualConfig.layers && 
                        dualConfig.layers.some((l: any) => l.skillcut && animName === l.skillcut)

                      // Debug: log once when animation changes
                      if (animName !== lastFrontAnimName) {


                      }

                      // If any layer's skillcut is playing on main skeleton, sync all layers to their skillcuts
                      if (isPlayingAnySkillcut && animName !== lastFrontAnimName && config.skillcut) {
                        state.clearTracks()
                        state.setAnimation(0, config.skillcut, false)
                        // Return to idle after skillcut with a slight delay
                        if (config.idle) {
                          state.addAnimation(0, config.idle, true, 0)
                        }
                      }
                      // Handle idle animation (if not in skillcut mode)
                      else if (!isPlayingAnySkillcut && animName === config.idle && config.idle) {
                        const currentLayerAnim = state.getCurrent(0)?.animation?.name
                        if (currentLayerAnim !== config.idle) {
                          state.setAnimation(0, config.idle, true)
                        }
                      }
                    })
                    lastFrontAnimName = animName || ''
                  }

                  // Render layers sorted by zIndex
                  if (dualLayerInstance && dualLayerInstance.layers) {
                    const sortedLayers = [...dualLayerInstance.layers].sort((a: any, b: any) => a.config.zIndex - b.config.zIndex)
                    
                    // Render layers with lower zIndex first (background), then main skeleton, then higher zIndex (foreground)
                    const mainZIndex = 1000 // Main skeleton rendered in the middle
                    
                    for (const layer of sortedLayers) {
                      if (layer.config.zIndex < mainZIndex) {
                        // Skip rendering if this layer's current animation matches the main skeleton's animation (avoid duplication)
                        const layerCurrentAnim = layer.state.getCurrent(0)?.animation?.name
                        if (layerCurrentAnim === animName) {
                          continue
                        }

                        // Hide shadow attachments on additional layers to avoid double shadow
                        const shadowSlot = layer.skeleton.findSlot('shadow')
                        if (shadowSlot) {
                          shadowSlot.attachment = null
                        }
                        
                        layer.state.update(1 / 60)
                        layer.state.apply(layer.skeleton)
                        layer.skeleton.updateWorldTransform()
                        originalDrawSkeleton(layer.skeleton, premultipliedAlpha)
                      }
                    }
                  }

                  // Render main skeleton
                  originalDrawSkeleton(skeleton, premultipliedAlpha)

                  // Render foreground layers
                  if (dualLayerInstance && dualLayerInstance.layers) {
                    const sortedLayers = [...dualLayerInstance.layers].sort((a: any, b: any) => a.config.zIndex - b.config.zIndex)
                    const mainZIndex = 1000

                    for (const layer of sortedLayers) {
                      if (layer.config.zIndex >= mainZIndex) {
                        // Skip rendering if this layer's current animation matches the main skeleton's animation (avoid duplication)
                        const layerCurrentAnim = layer.state.getCurrent(0)?.animation?.name
                        if (layerCurrentAnim === animName) {
                          continue
                        }

                        // Hide shadow attachments on additional layers to avoid double shadow
                        const shadowSlot = layer.skeleton.findSlot('shadow')
                        if (shadowSlot) {
                          shadowSlot.attachment = null
                        }
                        
                        layer.state.update(1 / 60)
                        layer.state.apply(layer.skeleton)
                        layer.skeleton.updateWorldTransform()
                        originalDrawSkeleton(layer.skeleton, premultipliedAlpha)
                      }
                    }
                  }

                  isRenderingMain = false
                } else if (skeleton !== mainSkeleton) {
                  originalDrawSkeleton(skeleton, premultipliedAlpha)
                }
              }
            }
          })
            }
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
  let id = market.live2d.current_id
  const isNoSuffix = id === 'tts_c017_02'

  let fileSuffix = '_00.'
  let route = globalParams.PATH_L2D + id + '/'

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

// Helper function to get skillcut path with fallback for variants
const getSkillcutPathing = (extension: string) => {
  const id = market.live2d.current_id
  let route = globalParams.PATH_L2D + id + '/' + globalParams.PATH_L2D_SKILLCUT

  // Try variant naming first (without _00 prefix for variants)
  if (id.includes('_')) {
    route += id + '_skillcut.' + extension
    return route
  }

  // Base character: use _00_skillcut naming
  route += id + '_00_skillcut.' + extension
  return route
}

const getDefaultAnimation = (availableAnimations?: Array<{ name: string }>) => {
  // Check character-specific overrides first
  const charId = market.live2d.current_id
  if (characterDefaultAnimations[charId]) {
    return characterDefaultAnimations[charId]
  }

  // Favorite characters default to idle_merged (unless overridden above)
  if (charId.includes('favorite')) return 'idle_merged'

  // Pose-specific defaults
  switch (market.live2d.current_pose) {
    case 'aim':
      return 'aim_idle'
    case 'cover':
      return 'cover_idle'
    case 'skillcut':
      return 'idle' // fallback to idle for skillcut
    default:
      return 'idle'
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
    const response = await fetch(skelUrl, { method: 'HEAD' }).catch(() => null)

    // Validate that response is an actual skeleton file (not HTML error page)
    if (response && isValidSkeletonFileResponse(response)) {
      return true
    }

    // If file not found and it's skillcut, try base character (e.g., c511_01 -> c511)
    if (pose === 'skillcut') {
      const characterId = market.live2d.current_id
      // Extract base character ID (e.g., c511_01 -> c511)
      const baseCharacterId = characterId.split('_')[0]

      if (baseCharacterId !== characterId) {
        // Try the base character's skillcut
        const baseRoute = globalParams.PATH_L2D + baseCharacterId + '/' + globalParams.PATH_L2D_SKILLCUT + baseCharacterId + '_00_skillcut.skel'
        const baseResponse = await fetch(baseRoute, { method: 'HEAD' }).catch(() => null)
        return baseResponse ? isValidSkeletonFileResponse(baseResponse) : false
      }
    }

    return false
  } catch (error) {
    return false
  }
}

// Helper function to validate that a fetch response is a valid skeleton file (not HTML)
const isValidSkeletonFileResponse = (response: Response): boolean => {
  // Check status first
  if (!response.ok) {
    return false
  }

  // Check Content-Type header to ensure it's binary data (not HTML error page)
  const contentType = response.headers.get('content-type')

  // If content-type is HTML, it's definitely an error page
  if (contentType && contentType.includes('text/html')) {
    return false
  }

  // Valid skeleton files should be binary (application/octet-stream) or not have explicit type
  // Invalid responses are usually text/html
  return true
}

import l2dData, { voiceMap, setCustomZoom, actionSoundConfig, reloadSoundConfig } from '@/utils/json/l2d.js'

let currentVoice = null as null | HTMLAudioElement
let currentReloadSound = null as null | HTMLAudioElement
let currentActionSound = null as null | HTMLAudioElement

// Track ALL active audio objects to stop them when character changes
let activeAudioObjects: HTMLAudioElement[] = []

// Track which character the current sounds belong to
let reloadSoundCharacterId = ''
let actionSoundCharacterId = ''

// Track voice index for sequential playback
const voiceIndexMap = new Map<string, number>()

// Cache to track which voice files actually exist (avoid repeated 404 attempts)
const voiceExistsCache = new Map<string, boolean>()

// Track action sound sequence - which number (1-10) should play next
let actionSoundIndex = 1

// Track reload sound sequence - which number (1-3) should play next
let reloadSoundIndex = 1
let shouldStopReloadFx = false  // Flag to prevent new FX from starting when user clicks

// Track pending timeouts so we can cancel them when switching poses
let pendingReloadTimeouts: number[] = []
let pendingReloadFxTimeouts: number[] = []  // Separate timeouts for FX only (can be stopped on click)
let pendingActionTimeouts: number[] = []

const handleAction = () => {
  if (!spinePlayer) return

  // Get available animations
  const animations = spinePlayer.animationState.data.skeletonData.animations
  const animationNames = animations.map((a: { name: string }) => a.name)

  // Helper to check if character ID is a "special" (non-standard) character
  // Standard = c + 3-4 digits, optionally with _XX suffix (like c011, c9021, c282_01, favorite_c080)
  // Special = anything else (like smol_*, ce009_*, tcr_*, eba*, etc.)
  const isSpecialCharacter = (id) => {
    const standardPattern = /^c\d{3,4}(?:_\d{1,2})?$|^favorite_c\d{3,4}(?:_\d{1,2})?$/
    return !standardPattern.test(id) // Special if NOT standard
  }

  // Determine action animation based on current pose
  let actionAnimation = 'action'
  let loopDurationMs = 0 // 0 means don't loop, play once

  // Check special click animations config - but only for truly SPECIAL (non-standard) characters
  if (specialClickAnimations[market.live2d.current_id] && isSpecialCharacter(market.live2d.current_id)) {
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
      loopDurationMs = 2000 // Loop this motion for 2 seconds
    }
  }
  // For standard c-series characters in specialClickAnimations, play normally without delay
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
      loopDurationMs = 0 // No delay for standard characters
    }
  }
  // For favorite characters, use expression_merged instead (unless already handled above)
  else if (market.live2d.current_id.includes('favorite')) {
    actionAnimation = 'expression_merged'
  }

  // Check if action animation exists, if not just play voice
  if (!animationNames.includes(actionAnimation)) {
    playVoice()
    return
  }

  // For special animations with loop duration, play them as looping
  // For normal animations (action, expression_merged), play them once
  spinePlayer.animationState.setAnimation(0, actionAnimation, loopDurationMs > 0)

  playVoice()

  // Determine idle animation based on current pose
  let idleAnimation = 'idle'
  
  // Check characterDefaultAnimations first (for characters with custom idle states like ce009_char_01)
  if (characterDefaultAnimations[market.live2d.current_id]) {
    idleAnimation = characterDefaultAnimations[market.live2d.current_id]
  } 
  // Check if character is in specialClickAnimations - if so, return to normal idle, not idle_merged
  else if (specialClickAnimations[market.live2d.current_id]) {
    idleAnimation = 'idle'
  } 
  // For other favorite characters, use idle_merged
  else if (market.live2d.current_id.includes('favorite')) {
    idleAnimation = 'idle_merged'
  } else if (['smol_anis', 'smol_prika', 'smol_mint'].includes(market.live2d.current_id)) {
    idleAnimation = 'pose_idle'
  } else if (market.live2d.current_id === 'c944') {
    idleAnimation = 'special_02'
  } else if (market.live2d.current_id === 'c994') {
    idleAnimation = 'idle_02'
  } else if (market.live2d.current_id === 'c996') {
    idleAnimation = 'idle_02'
  }

  // back to idle after action finish (only if idle animation exists)
  // If loopDurationMs > 0, delay the idle switch by that duration
  const delayMs = loopDurationMs > 0 ? loopDurationMs : 0
  if (animationNames.includes(idleAnimation)) {
    if (delayMs > 0) {
      // Delay the return to idle by loopDurationMs
      setTimeout(() => {
        spinePlayer.animationState.setAnimation(0, idleAnimation, true)
      }, delayMs)
    } else {
      // No delay, add animation normally
      spinePlayer.animationState.addAnimation(0, idleAnimation, true, 0)
    }
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

    // Cancel all pending timeouts that would continue playing sounds
    pendingReloadTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
    pendingReloadTimeouts = []

    pendingActionTimeouts.forEach((timeoutId) => clearTimeout(timeoutId))
    pendingActionTimeouts = []

    // Stop current BGM if playing
    if (currentBGM) {
      currentBGM.pause()
      currentBGM.currentTime = 0
      currentBGM = null
    }

    // Play BGM for oldtales
    if (market.live2d.current_id === 'oldtales') {
      currentBGM = new Audio('/assets/l2d/voice/oldtales/oldtales_bgm.ogg')
      currentBGM.loop = true
      currentBGM.volume = 0.5
      currentBGM.play().catch(() => {})
    }

    // Stop old character's voice when switching to new character
    if (currentVoice) {
      currentVoice.pause()
      currentVoice.currentTime = 0
      currentVoice = null
    }

    // Stop sound effects and clear character tracking
    if (currentReloadSound) {
      currentReloadSound.pause()
      currentReloadSound.currentTime = 0
      currentReloadSound = null
    }
    reloadSoundCharacterId = '' // Clear so pending timeouts know not to play

    if (currentActionSound) {
      currentActionSound.pause()
      currentActionSound.currentTime = 0
      currentActionSound.volume = 0 // Mute as extra safety
      currentActionSound = null
    }
    actionSoundCharacterId = '' // Clear so pending timeouts know not to play

    // Stop ALL active audio objects (in case some are lingering from overlaps)
    activeAudioObjects.forEach((audio) => {
      audio.pause()
      audio.currentTime = 0
      audio.volume = 0
    })
    activeAudioObjects = []

    if (currentSkillcutOverlaySound) {
      currentSkillcutOverlaySound.pause()
      currentSkillcutOverlaySound.currentTime = 0
      currentSkillcutOverlaySound = null
    }

    // Reset sound sequences
    actionSoundIndex = 1
    reloadSoundIndex = 1

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

    // Hide spine while loading new pose
    isSpineHidden.value = true

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

    // Cancel any in-flight zoom animation
    if (zoomFrameId !== null) {
      cancelAnimationFrame(zoomFrameId)
      zoomFrameId = null
    }

    // Reset BOTH transformScale and targetScale to base value
    const baseZoom = market.live2d.HQassets ? 0.18 : 0.5
    transformScale = baseZoom
    targetScale = baseZoom

    applyDefaultStyle2CanvasImmediate()

    // Hide spine temporarily while position is being reset
    isSpineHidden.value = true

    // Reapply custom zoom after reset immediately
    setTimeout(() => {
      canvas = document.querySelector('.spine-player-canvas') as HTMLCanvasElement
      if (canvas) {
        transformScale = setCustomZoom(market.live2d.current_id, canvas, transformScale, market.live2d.current_pose)
        // Also update targetScale to match so next scroll starts from correct value
        targetScale = transformScale
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
      // Cover mode needs larger canvas to show full character
      if (market.live2d.current_pose === 'cover') {
        canvas.style.height = '250vh'
        canvas.style.marginTop = 'calc(-75vh)'
        canvas.style.transform = 'scale(0.5)'
        canvas.style.position = 'absolute'
        canvas.style.left = '100px'  // Offset right for cover mode
        canvas.style.top = '0px'
      } else {
        canvas.style.height = market.live2d.HQassets ? '438vh' : '168vh'
        canvas.style.marginTop = market.live2d.HQassets ? 'calc(-171vh)' : 'calc(-30vh)'
        canvas.style.transform = market.live2d.HQassets ? 'scale(0.294)' : 'scale(0.7)'
        canvas.style.position = 'absolute'
        canvas.style.left = '0px'
        canvas.style.top = '0px'
      }
      const baseZoom = market.live2d.HQassets ? 0.18 : 0.5
      transformScale = baseZoom
      targetScale = baseZoom
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
    // Cover mode needs larger canvas to show full character
    if (market.live2d.current_pose === 'cover') {
      canvas.style.height = '250vh'
      canvas.style.marginTop = 'calc(-75vh)'
      canvas.style.transform = 'scale(0.5)'
      canvas.style.position = 'absolute'
      canvas.style.left = '400px'
      canvas.style.top = '0px'
    } else {
      canvas.style.height = market.live2d.HQassets ? '438vh' : '168vh'
      canvas.style.marginTop = market.live2d.HQassets ? 'calc(-171vh)' : 'calc(-30vh)'
      canvas.style.transform = market.live2d.HQassets ? 'scale(0.294)' : 'scale(0.7)'
      canvas.style.position = 'absolute'
      canvas.style.left = '0px'
      canvas.style.top = '0px'
    }
    const baseZoom = market.live2d.HQassets ? 0.18 : 0.5
    transformScale = baseZoom
    targetScale = baseZoom
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
  // Skip centering for cover mode - let the custom positioning from applyDefaultStyle2Canvas take effect
  if (market.live2d.current_pose === 'cover') {
    return
  }
  
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
  // Only allow left-click drag (button 0), disable middle-click (button 2) and right-click (button 1)
  if (filterDomEvents(e) && e.button === 0) {
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
  // Only allow left-click drag (buttons bitmask: 1 = left-click)
  if (move && canvas && (e.buttons & 1) === 1) {
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
 * zoom in or out for the live2d with SMOOTH ANIMATION
 * it uses the property transform scale instead of buffing up or down viewport height of the canvas
 * using the vh in nikke db legacy produces some lag when zooming at high values ( 450 - 500 vh of size)
 * transform should hopefully fix this issue, but to fix blurring/pixelated images
 * the canvas is already bruteforced to 500vh and transform scale 0.2
 * 
 * NEW: Smooth zoom animation using requestAnimationFrame
 * - Moves 15% closer to target zoom each frame for smooth visual feedback
 * - Prevents jarring instant zoom changes
 */

// Zoom constants
const MIN_SCALE = 0.05
const MAX_SCALE = 5.0
const ZOOM_FACTOR = 1.5      // Each scroll = 50% change
const ZOOM_SMOOTHING = 0.15  // 15% closer per frame

// Zoom state variables
let transformScale = 0.5      // Current zoom level
let targetScale = 0.5         // Target zoom level (for smooth animation)
let zoomFrameId: number | null = null  // Track animation frame

// Zoom anchor variables - tracks which part of character stays visible
let anchorX = 0               // Character X coordinate at zoom center
let anchorY = 0               // Character Y coordinate at zoom center
let anchorScreenX = 0         // Screen X where zoom center is
let anchorScreenY = 0         // Screen Y where zoom center is
let anchorMarginTop = 0       // Canvas margin top for position calculation

// Capture the zoom anchor point (defaults to screen center)
const captureAnchor = (screenX?: number, screenY?: number) => {
  if (!canvas) return
  const style = getComputedStyle(canvas)
  const left = parseFloat(style.left) || 0
  const top = parseFloat(style.top) || 0
  const marginTop = parseFloat(style.marginTop) || 0
  const width = canvas.offsetWidth
  const height = canvas.offsetHeight
  if (!width || !height) return
  
  const sw = window.innerWidth
  const sh = window.innerHeight
  
  // Use provided screen coords, or default to screen center
  anchorScreenX = screenX !== undefined ? screenX : sw / 2
  anchorScreenY = screenY !== undefined ? screenY : sh / 2
  
  const visualLeft = left
  const visualTop = top + marginTop
  
  // Calculate which part of the character is at the anchor point
  anchorX = width / 2 + (anchorScreenX - visualLeft - width / 2) / transformScale
  anchorY = height / 2 + (anchorScreenY - visualTop - height / 2) / transformScale
  
  anchorMarginTop = marginTop
}

// Apply zoom while keeping anchor point fixed on screen
const applyScaleWithAnchor = (scale: number) => {
  if (!canvas) return
  const width = canvas.offsetWidth
  const height = canvas.offsetHeight
  if (!width || !height) {
    canvas.style.transform = 'scale(' + scale + ')'
    return
  }
  
  // Calculate new canvas position to keep anchor point at same screen location
  const newVisualLeft = anchorScreenX - width / 2 - (anchorX - width / 2) * scale
  const newVisualTop = anchorScreenY - height / 2 - (anchorY - height / 2) * scale
  
  canvas.style.left = newVisualLeft + 'px'
  canvas.style.top = (newVisualTop - anchorMarginTop) + 'px'
  canvas.style.transform = 'scale(' + scale + ')'
}

// Helper: clamp scale to valid bounds
const clampScale = (value: number): number => {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value))
}

// Helper: directly set zoom level (used for initial setup)
const setTransformScale = (value: number) => {
  transformScale = clampScale(value)
  targetScale = transformScale
  if (canvas) {
    canvas.style.transform = 'scale(' + transformScale + ')'
  }
}

// Smooth zoom animation: one frame step
const zoomSmoothingStep = () => {
  // Re-capture anchor each frame to preserve any drags during animation
  captureAnchor()
  
  const diff = targetScale - transformScale
  
  if (Math.abs(diff) < 0.0005) {
    // Close enough to target, stop animating
    transformScale = targetScale
    zoomFrameId = null
  } else {
    // Move 15% closer to target each frame
    transformScale += diff * ZOOM_SMOOTHING
    zoomFrameId = requestAnimationFrame(zoomSmoothingStep)
  }
  applyScaleWithAnchor(transformScale)
}

// Start smooth zoom animation
const startZoomSmoothing = () => {
  if (zoomFrameId !== null) {
    cancelAnimationFrame(zoomFrameId)
  }
  zoomFrameId = requestAnimationFrame(zoomSmoothingStep)
}

// Wheel zoom handler with smooth animation
const onWheel = (e: WheelEvent) => {
  // Check if scrolling is over UI panels - if so, don't zoom
  const target = e.target as HTMLElement
  
  // Stop zooming if scrolling over left panel (character list) or right panel (tools)
  if (target) {
    const isUiPanel = target.closest('#l2dsearchbox') ||  // Left character list panel
                     target.closest('.toolList') ||       // Right tools panel
                     target.closest('.n-drawer')          // Gallery drawer/modal
    
    if (isUiPanel) {
      return  // Don't zoom, allow normal scroll on UI
    }
  }

  if (!canvas) return

  // Mark that user has manually zoomed
  hasUserZoomed = true

  // CRITICAL: Read the actual current scale from the canvas (fixes direction bug)
  const currentTransform = canvas.style.transform
  const scaleMatch = currentTransform.match(/scale\(([\d.]+)\)/)
  const actualCurrentScale = scaleMatch ? parseFloat(scaleMatch[1]) : transformScale
  
  // Update our internal tracking to match reality
  transformScale = actualCurrentScale

  // Capture anchor BEFORE calculating zoom (defaults to screen center)
  captureAnchor()

  const direction = e.deltaY > 0 ? -1 : 1  // Scroll down = zoom out, up = zoom in
  // Use the actual current scale, not the stale targetScale
  targetScale = clampScale(actualCurrentScale * Math.pow(ZOOM_FACTOR, direction))
  startZoomSmoothing()
}

document.addEventListener('wheel', onWheel)

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
  
  &.cover {
    overflow: visible;
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


<style scoped>
/* Disable HTML5 Drag and Drop API for cover mode */
#player-container.cover .spine-player-canvas {
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}

#player-container.cover .spine-player {
  user-select: none;
  -webkit-user-select: none;
}
</style>
