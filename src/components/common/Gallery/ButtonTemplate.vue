<template>
  <div class="button-wrapper">
    <!-- Image button if exists -->
    <div v-if="hasImage" class="image-button-container" @click="load()" :class="{ active: isActive }">
      <img :src="buttonImagePath" :alt="dataToLoad.title" class="button-image" @error="onImageError" />
    </div>
    <!-- Text button fallback -->
    <n-button v-else round @click="load()"
        :ghost="!isActive"
        :type="isActive ? 'success' : 'info'"
        >{{ dataToLoad.title }}</n-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { galleryInterface } from '@/utils/interfaces/gallery'

const props = defineProps<{
  carouselData: galleryInterface | null,
  currentId: string,
  dataToLoad: galleryInterface

}>()

const emit = defineEmits(['loadData'])

const imageExists = ref(true)

const load = () => {
  if (props.currentId !== props.dataToLoad.id) {
    emit('loadData', props.dataToLoad)
  }
}

const isActive = computed(() => {
  return props.carouselData !== null && props.carouselData.id === props.dataToLoad.id
})

const buttonImagePath = computed(() => {
  return `/assets/images/button/usertitle_${props.dataToLoad.id}.png`
})

// Auto-detect by trying to load the image
const hasImage = computed(() => {
  return imageExists.value
})

const onImageError = () => {
  imageExists.value = false
}

</script>

<style scoped lang="less">
.button-wrapper {
  display: block;
  width: 100%;
  margin-bottom: 8px;
}

.n-button {
  width: 100%;
  margin-right: 0;
  margin-bottom: 0;
}

.image-button-container {
  cursor: pointer;
  transition: transform 0.2s ease, filter 0.2s ease;
  display: block;
  width: 200px;
  height: 56px;
  border-radius: 6px;
  overflow: hidden;
  border: 2px solid transparent;
  margin: 0 auto;

  &:hover {
    transform: scale(1.05);
    filter: brightness(1.1);
  }

  &.active {
    border: 2px solid #63e77b;
    box-shadow: 0 0 12px rgba(99, 231, 123, 0.5);
  }

  &:not(.active) {
    border: 2px solid rgba(99, 231, 123, 0.3);
  }
}

.button-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>