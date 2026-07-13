<template>
  <div class="poseButtonGroup">
    <n-button
      v-for="pose in poses"
      :key="pose.value"
      :type="market.live2d.current_pose === pose.value ? 'success' : 'default'"
      :disabled="!poseAvailability[pose.value]"
      ghost
      round
      size="small"
      @click="market.live2d.current_pose = pose.value"
      class="poseButton"
    >
      <component :is="pose.label" />
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { useMarket } from '@/stores/market'
import { NIcon, NButton } from 'naive-ui'
import { AimOutlined } from '@vicons/antd'
import { AccessibilityTwotone } from '@vicons/material'
import { h, ref, watch } from 'vue'
import ManageProtection from '@vicons/carbon/ManageProtection'
import { globalParams } from '@/utils/enum/globalParams'
const market = useMarket()

const poseAvailability = ref<Record<string, boolean>>({
  aim: true,
  cover: true,
  fb: true,
  skillcut: true
})

const poses = ref<Array<{value: 'fb' | 'aim' | 'cover' | 'skillcut', label: any}>>([
  {
    value: 'aim',
    label: h('div', {
    }, [
      h(NIcon, {
        component: AimOutlined,
        size: 18,
        style: 'position:relative; top:3px'
      }),
      ' Aim'
    ])
  },
  {
    value: 'cover',
    label: h('div', {
    }, [
      h(NIcon, {
        component: ManageProtection,
        size: 18,
        style: 'position:relative; top:5px'
      }),
      ' Cover'
    ])
  },
  {
    value: 'fb',
    label: h('div', {
    }, [
      h(NIcon, {
        component: AccessibilityTwotone,
        size: 18,
        style: 'position:relative; top:3px'
      }),
      ' Full Body'
    ])
  },
  {
    value: 'skillcut',
    label: h('div', {
    }, [
      h(NIcon, {
        component: AimOutlined,
        size: 18,
        style: 'position:relative; top:3px'
      }),
      ' Skillcut'
    ])
  }
])

import { charactersWithoutAimAndCover } from '@/utils/json/l2d.js'

// Check if pose files exist by trying to fetch the skel file
const checkPoseExists = async (characterId: string, pose: 'aim' | 'cover' | 'skillcut'): Promise<boolean> => {
  try {
    let url: string
    
    switch (pose) {
      case 'aim':
        url = `${globalParams.PATH_L2D}${characterId}/aim/${characterId}_aim_00.skel`
        break
      case 'cover':
        url = `${globalParams.PATH_L2D}${characterId}/cover/${characterId}_cover_00.skel`
        break
      case 'skillcut':
        // Variants (c513_01, c511_01, etc.) use _skillcut naming (without _00 prefix)
        // Base characters use _00_skillcut
        if (characterId.includes('_')) {
          url = `${globalParams.PATH_L2D}${characterId}/skill/${characterId}_skillcut.skel`
          let isValid = await validateSkeletonFile(url)
          if (isValid) return true
          
          // If variant doesn't have its own, fallback to base character
          const baseId = characterId.split('_')[0]
          url = `${globalParams.PATH_L2D}${baseId}/skill/${baseId}_00_skillcut.skel`
          return await validateSkeletonFile(url)
        } else {
          url = `${globalParams.PATH_L2D}${characterId}/skill/${characterId}_00_skillcut.skel`
          return await validateSkeletonFile(url)
        }
    }
    
    return await validateSkeletonFile(url)
  } catch (error) {
    return false
  }
}

// Helper function to validate that a response is actually a skeleton file
const validateSkeletonFile = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { method: 'HEAD' }).catch(() => null)
    
    if (!response?.ok) {
      return false
    }
    
    // Check Content-Type header to ensure it's binary data (not HTML error page)
    const contentType = response.headers.get('content-type')
    
    // Valid skel files should be binary (application/octet-stream) or similar
    // Invalid responses are usually text/html
    if (contentType && contentType.includes('text/html')) {
      return false
    }
    
    return true
  } catch (error) {
    return false
  }
}

// Update availability when character changes
watch(
  () => market.live2d.current_id,
  async () => {
    const characterId = market.live2d.current_id
    
    // Check all poses concurrently
    const [aimExists, coverExists, skillcutExists] = await Promise.all([
      checkPoseExists(characterId, 'aim'),
      checkPoseExists(characterId, 'cover'),
      checkPoseExists(characterId, 'skillcut')
    ])
    
    poseAvailability.value = {
      aim: aimExists,
      cover: coverExists,
      fb: true,
      skillcut: skillcutExists
    }
  },
  { immediate: true }
)
</script>

<style scoped lang="less">
.poseButtonGroup {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.poseButton {
  width: 100%;
  height: 40px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px !important;
}
</style>
//