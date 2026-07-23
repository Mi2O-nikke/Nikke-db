<template>
  <span>
    <n-button ghost type="error" round @click="openDrawer()" class="triggerButton">
      Gallery
    </n-button>

    <n-drawer
        resizable
        v-model:show="isDrawerVisible"
        placement="right"
        default-width="300"
        :mask-closable="false"
        :show-mask="false">
      <n-drawer-content closable :native-scrollbar="false" resizable>

        <template #header>
          Gallery
        </template>

        <n-h2>Story</n-h2>
        <ButtonTemplate
          v-for="buttonItem in buttonListStory"
          :key="buttonItem.data.id"
          :data-to-load="buttonItem.data"
          :carousel-data="carouselData" :current-id="currentId" @load-data="(data: galleryInterface) => handleGalleryButtonClick(data)"
        />

        <n-h2>Side Stories</n-h2>
        <ButtonTemplate
            v-for="buttonItem in buttonListSideStory"
            :key="buttonItem.data.id"
            :data-to-load="buttonItem.data"
            :carousel-data="carouselData" :current-id="currentId" @load-data="(data: galleryInterface) => handleGalleryButtonClick(data)"
        />

        <n-h2>Events</n-h2>
        <ButtonTemplate
          v-for="buttonItem in buttonListEvents"
          :key="buttonItem.data.id"
          :data-to-load="buttonItem.data"
          :carousel-data="carouselData" :current-id="currentId" @load-data="(data: galleryInterface) => handleGalleryButtonClick(data)"
        />

        <n-h2>Other</n-h2>
        <ButtonTemplate
          v-for="buttonItem in buttonListOther"
          :key="buttonItem.data.id"
          :data-to-load="buttonItem.data"
          :carousel-data="carouselData" :current-id="currentId" @load-data="(data: galleryInterface) => handleGalleryButtonClick(data)"
        />

        <n-h2>Community Content</n-h2>
        <ButtonTemplate
          v-for="buttonItem in buttonListCommunity"
          :key="buttonItem.data.id"
          :data-to-load="buttonItem.data"
          :carousel-data="carouselData" :current-id="currentId" @load-data="(data: galleryInterface) => handleGalleryButtonClick(data)"
        />

      </n-drawer-content>

    </n-drawer>

    <!-- Gallery Grid Modal -->
    <div v-if="showGridModal" class="modal-overlay" @click="closeGridModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <n-h3 style="margin: 0;">{{ carouselData === null ? 'No data selected' : carouselData.title }}</n-h3>
          <n-button text type="error" @click="closeGridModal" style="font-size: 24px; padding: 0;">
            ✕
          </n-button>
        </div>
        <!-- GALLERY GRID -->
        <div v-if="carouselData !== null" class="gallery-grid">
          <div
            v-for="(data, idx) in carouselData.content"
            :key="data.name"
            class="gallery-item"
            @click="openImageModal(idx)"
          >
            <img
              :src="globalParams.GALLERY + carouselData.path + data.name + (data.name.includes('.') ? '' : '.png')"
              :alt="data.text"
              class="gallery-thumbnail"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Image Viewer Modal -->
    <div 
      v-if="showImageModal" 
      class="image-viewer-overlay" 
      @click="handleOverlayClick"
      @wheel.prevent="handleScroll"
      @mousedown="startPanning"
      @mousemove="handlePanning"
      @mouseup="stopPanning"
      @mouseleave="handleMouseLeave"
      @dragstart.prevent
    >
      <img
        v-if="carouselData !== null && currentImageData"
        :src="currentImageUrl"
        :alt="currentImageData.text"
        class="floating-image"
        :style="{ 
          transform: `scale(${imageScale}) translate(${panX}px, ${panY}px)`,
          cursor: isPanning ? 'grabbing' : 'grab'
        }"
        loading="lazy"
        @click.stop
        @mousedown.stop
        @dragstart.prevent
      />
    </div>

  </span>
</template>

<script setup lang="ts">

import { ref, watch, computed } from 'vue'
import { useMarket } from '@/stores/market'
import type { galleryInterface } from '@/utils/interfaces/gallery'
import { messagesEnum, globalParams } from '@/utils/enum/globalParams'
import ArrowTemplate from '@/components/common/Gallery/ArrowTemplate.vue'
import ButtonTemplate from '@/components/common/Gallery/ButtonTemplate.vue'

import _2x2love from '@/utils/json/Gallery/2x2love.json'
import _4koma_en from '@/utils/json/Gallery/4koma_en.json'
import _4koma_jp from '@/utils/json/Gallery/4koma_jp.json'
import _4koma_kr from '@/utils/json/Gallery/4koma_kr.json'
import _4koma_zh from '@/utils/json/Gallery/4koma_zh.json'
import absolute from '@/utils/json/Gallery/absolute.json'
import albums from '@/utils/json/Gallery/albums.json'
import arkguardian from '@/utils/json/Gallery/arkguardian.json'
import arkranger from '@/utils/json/Gallery/arkranger.json'
import azxservicetime from '@/utils/json/Gallery/azxservicetime.json'
import bbqmaster from '@/utils/json/Gallery/bbqmaster.json'
import beautyfullshot from '@/utils/json/Gallery/beautyfullshot.json'
import bfgcleanup from '@/utils/json/Gallery/bfgcleanup.json'
import blankticket from '@/utils/json/Gallery/blankticket.json'
import bluewaterisland from '@/utils/json/Gallery/bluewaterisland.json'
import bonds from '@/utils/json/Gallery/bonds.json'
import boomsday from '@/utils/json/Gallery/boomsday.json'
import boomtheghost from '@/utils/json/Gallery/boomtheghost.json'
import brandnewyear from '@/utils/json/Gallery/brandnewyear.json'
import bsideidol from '@/utils/json/Gallery/bsideidol.json'
import _777 from '@/utils/json/Gallery/777.json'
import chocolateplease from '@/utils/json/Gallery/chocolateplease.json'
import coinsinrush from '@/utils/json/Gallery/coinsinrush.json'
import colorless from '@/utils/json/Gallery/colorless.json'
import darkhero from '@/utils/json/Gallery/darkhero.json'
import doutsiders from '@/utils/json/Gallery/doutsiders.json'
import dragondungeonrun from '@/utils/json/Gallery/dragondungeonrun.json'
import evangelion from '@/utils/json/Gallery/evangelion.json'
import foolburstday from '@/utils/json/Gallery/foolburstday.json'
import foolmetalpanic from '@/utils/json/Gallery/foolmetalpanic.json'
import footstepwalkrun from '@/utils/json/Gallery/footstepwalkrun.json'
import forrest from '@/utils/json/Gallery/forrest.json'
import fullfoolday from '@/utils/json/Gallery/fullfoolday.json'
import goddessfall from '@/utils/json/Gallery/goddessfall.json'
import goldencoinrush from '@/utils/json/Gallery/goldencoinrush.json'
import goninjathief from '@/utils/json/Gallery/goninjathief.json'
import icedragonsaga from '@/utils/json/Gallery/icedragonsaga.json'
import jinxplayer from '@/utils/json/Gallery/jinxplayer.json'
import juveniledays from '@/utils/json/Gallery/juveniledays.json'
import killthelord from '@/utils/json/Gallery/killthelord.json'
import lastkingdom from '@/utils/json/Gallery/lastkingdom.json'
import liarsend from '@/utils/json/Gallery/liarsend.json'
import liecauserecoil from '@/utils/json/Gallery/liecauserecoil.json'
import madeinrush from '@/utils/json/Gallery/madeinrush.json'
import memoriesteller from '@/utils/json/Gallery/memoriesteller.json'
import miraclesnow from '@/utils/json/Gallery/miraclesnow.json'
import neverland from '@/utils/json/Gallery/neverland.json'
import newflavor from '@/utils/json/Gallery/newflavor.json'
import nyanyaparadise from '@/utils/json/Gallery/nyanyaparadise.json'
import oldtales from '@/utils/json/Gallery/oldtales.json'
import outerautomata from '@/utils/json/Gallery/outerautomata.json'
import projectmatis from '@/utils/json/Gallery/projectmatis.json'
import overthehorizon from '@/utils/json/Gallery/overthehorizon.json'
import overzone from '@/utils/json/Gallery/overzone.json'
import rebornevil from '@/utils/json/Gallery/rebornevil.json'
import recipeforyou from '@/utils/json/Gallery/recipeforyou.json'
import redash from '@/utils/json/Gallery/redash.json'
import seayouagain from '@/utils/json/Gallery/seayouagain.json'
import secondquest from '@/utils/json/Gallery/secondquest.json'
import side01 from '@/utils/json/Gallery/side01.json'
import side02 from '@/utils/json/Gallery/side02.json'
import side03 from '@/utils/json/Gallery/side03.json'
import side04 from '@/utils/json/Gallery/side04.json'
import side05 from '@/utils/json/Gallery/side05.json'
import sineditor from '@/utils/json/Gallery/sineditor.json'
import snowfalloasis from '@/utils/json/Gallery/snowfalloasis.json'
import staranis from '@/utils/json/Gallery/staranis.json'
import story1 from '@/utils/json/Gallery/story1.json'
import story10 from '@/utils/json/Gallery/story10.json'
import story11 from '@/utils/json/Gallery/story11.json'
import story12 from '@/utils/json/Gallery/story12.json'
import story2 from '@/utils/json/Gallery/story2.json'
import story3 from '@/utils/json/Gallery/story3.json'
import story4 from '@/utils/json/Gallery/story4.json'
import story5 from '@/utils/json/Gallery/story5.json'
import story6 from '@/utils/json/Gallery/story6.json'
import story7 from '@/utils/json/Gallery/story7.json'
import story8 from '@/utils/json/Gallery/story8.json'
import story9 from '@/utils/json/Gallery/story9.json'
import terminusticket from '@/utils/json/Gallery/terminusticket.json'
import unbreakablesphere from '@/utils/json/Gallery/unbreakablesphere.json'
import voltroad from '@/utils/json/Gallery/voltroad.json'
import whitememory from '@/utils/json/Gallery/whitememory.json'

const market = useMarket()

const isDrawerVisible = ref(false)
const carouselData = ref<galleryInterface | null>(null)
const index = ref(1)
const currentId = ref('')
const showGridModal = ref(false)
const showImageModal = ref(false)
const imageScale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartY = ref(0)
const panStartPanX = ref(0)
const panStartPanY = ref(0)

interface buttonInterface {
  data: galleryInterface
}

const openDrawer = () => {
  isDrawerVisible.value = true
}

const closeGridModal = () => {
  showGridModal.value = false
  carouselData.value = null
  currentId.value = ''
}

const closeImageModal = () => {
  showImageModal.value = false
}

const handleOverlayClick = (event: MouseEvent) => {
  // Only close if clicking on the overlay background, not during panning
  if (event.target === event.currentTarget && !isPanning.value) {
    closeImageModal()
  }
}

const handleGalleryButtonClick = (data: galleryInterface) => {
  carouselData.value = null
  index.value = 1
  carouselData.value = data
  currentId.value = data.id
  showGridModal.value = true
  successFeedback()
}

const openImageModal = (imageIndex: number) => {
  index.value = imageIndex + 1
  imageScale.value = 1
  panX.value = 0
  panY.value = 0
  showImageModal.value = true
}

const currentImageData = computed(() => {
  if (!carouselData.value || !carouselData.value.content) return null
  return carouselData.value.content[index.value - 1]
})

const currentImageUrl = computed(() => {
  if (!carouselData.value || !currentImageData.value) return ''
  const data = currentImageData.value
  return globalParams.GALLERY + carouselData.value.path + data.name + (data.name.includes('.') ? '' : '.png')
})

const handleScroll = (event: WheelEvent) => {
  const scaleSpeed = 0.1
  const direction = event.deltaY > 0 ? -1 : 1
  const newScale = imageScale.value + direction * scaleSpeed
  imageScale.value = Math.max(1, Math.min(newScale, 5))
}

const startPanning = (event: MouseEvent) => {
  // Only pan if clicking on the overlay, not the image
  if (event.target !== event.currentTarget) return
  
  isPanning.value = true
  panStartX.value = event.clientX
  panStartY.value = event.clientY
  panStartPanX.value = panX.value
  panStartPanY.value = panY.value
}

const handlePanning = (event: MouseEvent) => {
  if (!isPanning.value) return
  
  const deltaX = event.clientX - panStartX.value
  const deltaY = event.clientY - panStartY.value
  
  panX.value = panStartPanX.value + deltaX
  panY.value = panStartPanY.value + deltaY
}

const stopPanning = () => {
  isPanning.value = false
}

const handleMouseLeave = () => {
  // Only stop panning if not currently panning
  if (!isPanning.value) {
    stopPanning()
  }
}

const previousImage = () => {
  if (index.value > 1) {
    index.value--
    imageScale.value = 1
    panX.value = 0
    panY.value = 0
  }
}

const nextImage = () => {
  if (carouselData.value && index.value < carouselData.value.content.length) {
    index.value++
    imageScale.value = 1
    panX.value = 0
    panY.value = 0
  }
}

// Watch drawer visibility to hide/show UI
watch(isDrawerVisible, (newVal) => {
  if (newVal) {
    // Don't hide UI - keep modal visible
    // market.live2d.triggerHideUI()
  } else {
    // market.live2d.triggerShowUI()
  }
})

const buttonListStory = [
  { data: story1 },
  { data: story2 },
  { data: story3 },
  { data: story4 },
  { data: story5 },
  { data: story6 },
  { data: story7 },
  { data: story8 },
  { data: story9 },
  { data: story10 },
  { data: story11 },
  { data: story12 }
] as buttonInterface[]

const buttonListSideStory = [
  { data: side01 },
  { data: side02 },
  { data: side03 },
  { data: side04 },
  { data: side05 }
] as buttonInterface[]

const buttonListEvents = [
  { data: _2x2love },
  { data: absolute },
  { data: arkguardian },
  { data: arkranger },
  { data: beautyfullshot },
  { data: blankticket },
  { data: bluewaterisland },
  { data: boomsday },
  { data: boomtheghost },
  { data: brandnewyear },
  { data: bsideidol },
  { data: _777 },
  { data: chocolateplease },
  { data: coinsinrush },
  { data: colorless },
  { data: darkhero },
  { data: doutsiders },
  { data: evangelion },
  { data: foolburstday },
  { data: foolmetalpanic },
  { data: footstepwalkrun },
  { data: forrest },
  { data: fullfoolday },
  { data: goddessfall },
  { data: goldencoinrush },
  { data: goninjathief },
  { data: icedragonsaga },
  { data: jinxplayer },
  { data: juveniledays },
  { data: killthelord },
  { data: lastkingdom },
  { data: liarsend },
  { data: liecauserecoil },
  { data: memoriesteller },
  { data: miraclesnow },
  { data: neverland },
  { data: newflavor },
  { data: nyanyaparadise },
  { data: oldtales },
  { data: outerautomata },
  { data: overthehorizon },
  { data: overzone },
  { data: projectmatis },
  { data: rebornevil },
  { data: recipeforyou },
  { data: redash },
  { data: seayouagain },
  { data: secondquest },
  { data: sineditor },
  { data: snowfalloasis },
  { data: staranis },
  { data: terminusticket },
  { data: unbreakablesphere },
  { data: whitememory }
] as buttonInterface[]

const buttonListOther = [
  { data: albums },
  { data: bonds },
  { data: bbqmaster },
  { data: voltroad },
  { data: dragondungeonrun },
  { data: bfgcleanup },
  { data: madeinrush },
  { data: azxservicetime }
] as buttonInterface[]

const buttonListCommunity = [
  { data: _4koma_en },
  { data: _4koma_jp },
  { data: _4koma_kr },
  { data: _4koma_zh }
] as buttonInterface[]

const successFeedback = () => {
  market.message.getMessage().success(messagesEnum.MESSAGE_ASSET_LOADED)
}

const updateIndex = (newIndex: number) => {
  index.value = newIndex + 1
}

</script>

<style scoped lang="less">
.triggerButton {
  width: 100%;
  height: 40px;
}

.n-h2 {
  margin-top: 16px;
}

.n-carousel {
  margin: 0 auto;
  .n-h3 {
    margin-top: 10px;
    margin-bottom: 20px;
  }
}

/* Modal Overlay Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  animation: fadeIn 0.2s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.modal-content {
  background-color: #1a1a1a;
  border-radius: 8px;
  width: 85vw;
  height: 80vh;
  min-width: 800px;
  min-height: 500px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.3s ease-out;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 24px 16px 24px;
  gap: 16px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.modal-header .n-h3 {
  flex: 1;
  margin: 0;
}

/* Gallery Grid Styles */
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  padding: 24px;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  width: 90%;
  box-sizing: border-box;
  align-content: start;
}

.gallery-item {
  cursor: pointer;
  border-radius: 8px;

  transition: transform 0.2s ease, box-shadow 0.2s ease;
  aspect-ratio: 1;
  background-color: rgba(255, 255, 255, 0.05);
}

.gallery-item:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(255, 255, 255, 0.1);
}

.gallery-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* Image Modal Content - Larger for carousel */
.image-modal-content {
  background-color: #1a1a1a;
  border-radius: 8px;
  padding: 24px;
  max-width: 95vw;
  max-height: 95vh;
  overflow-y: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.3s ease-out;
}

/* Image Viewer Styles */
.image-viewer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  overflow: hidden;
}

.floating-image {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
  transition: transform 0.05s ease-out;
}
</style>