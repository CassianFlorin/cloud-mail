<template>
  <div class="login-preview" :style="backgroundStyle" aria-hidden="true">
    <div v-if="!background" class="preview-clouds">
      <span class="preview-cloud cloud-one"></span>
      <span class="preview-cloud cloud-two"></span>
    </div>
    <div class="preview-panel" :style="panelStyle">
      <strong class="preview-title">{{ title }}</strong>
      <span class="preview-description">{{ $t('loginTitle') }}</span>
      <div class="preview-input">
        <span>{{ $t('emailAccount') }}</span>
        <span v-if="!hideDomain && domain" class="preview-domain">{{ domain }}</span>
      </div>
      <div class="preview-input">{{ $t('password') }}</div>
      <div class="preview-submit">{{ $t('loginBtn') }}</div>
    </div>
  </div>
</template>

<script setup>
import {computed} from 'vue';

const props = defineProps({
  title: {type: String, default: ''},
  background: {type: String, default: ''},
  opacity: {type: Number, default: 1},
  dark: {type: Boolean, default: false},
  domain: {type: String, default: ''},
  hideDomain: {type: Boolean, default: false}
});

const backgroundStyle = computed(() => props.background
    ? {backgroundImage: `url(${JSON.stringify(props.background)})`} : {});

// Mirror the real login panel's white/black overlay and configured opacity.
const panelStyle = computed(() => {
  const channel = props.dark ? 0 : 255;
  const opacity = Number.isFinite(props.opacity) ? Math.min(1, Math.max(0, props.opacity)) : 1;
  return {backgroundColor: `rgba(${channel}, ${channel}, ${channel}, ${opacity})`};
});
</script>

<style scoped lang="scss">
.login-preview {
  position: relative;
  display: flex;
  justify-content: flex-end;
  min-height: 240px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid var(--el-border-color-light);
  background: linear-gradient(to bottom, #2980b9, #6dd5fa, #fff);
  background-size: cover;
  background-position: center;
}

.preview-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 58%;
  min-width: 0;
  box-sizing: border-box;
  padding: 22px 16px;
  border-left: 1px solid var(--el-border-color-light);
  color: var(--el-text-color-primary);
  box-shadow: -8px 0 24px rgb(0 0 0 / 5%);
}

.preview-title {
  font-size: 17px;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.preview-description {
  font-size: 10px;
  margin: 5px 0 16px;
  color: var(--el-text-color-secondary);
}

.preview-input {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
  min-height: 28px;
  margin-bottom: 10px;
  padding: 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  background: var(--el-bg-color);
  font-size: 10px;
  color: var(--el-text-color-placeholder);
}

.preview-domain {
  max-width: 65%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-regular);
}

.preview-submit {
  padding: 8px;
  border-radius: 4px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  text-align: center;
}

.preview-cloud {
  position: absolute;
  width: 100px;
  height: 30px;
  border-radius: 40px;
  background: rgb(255 255 255 / 65%);

  &::before, &::after {
    content: '';
    position: absolute;
    bottom: 8px;
    width: 45px;
    height: 45px;
    border-radius: 50%;
    background: inherit;
  }

  &::before { left: 14px; }
  &::after { right: 12px; bottom: 2px; }
}

.cloud-one { top: 50px; left: -20px; }
.cloud-two { bottom: 40px; left: 30px; transform: scale(0.65); }
</style>
