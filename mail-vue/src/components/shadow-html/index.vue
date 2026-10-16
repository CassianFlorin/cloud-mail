<template>
  <div class="content-box" ref="contentBox">
    <iframe
      ref="frame"
      class="content-html"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerpolicy="no-referrer"
      title="email"
    ></iframe>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  html: {
    type: String,
    required: true
  }
})

const frame = ref(null)
const contentBox = ref(null)

function readBodyStyle(html) {
  const tag = html.match(/<body[^>]*>/i);
  if (!tag) return '';
  // data-cm-inline 保存被拦下的原始样式，不能把它当成 body 的 style。
  const style = tag[0].match(/(?:^|\s)style\s*=\s*"([^"]*)"/i);
  return style ? style[1] : '';
}

function documentHtml(html) {
  const cleanedHtml = html.replace(/<\/?body[^>]*>/gi, '');
  // sandbox 没有 allow-scripts，邮件里的脚本和事件不会执行。
  // allow-same-origin 用来量高度，并让本页生成的 blob 图片能显示。不能再打开脚本。
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; media-src blob: data:; style-src 'unsafe-inline'; font-src blob: data:; form-action 'none'"><style>
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Inter, 'Helvetica Neue', Helvetica, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', '微软雅黑', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #13181D;
      word-break: break-word;
    }
    h1, h2, h3, h4 { font-size: 18px; font-weight: 700; }
    p { margin: 0; }
    a { text-decoration: none; color: #0E70DF; }
    .shadow-content { background: #FFFFFF; width: fit-content; min-width: 100%; }
    img:not(table img) { max-width: 100%; height: auto !important; }
  </style></head><body><div class="shadow-content">${cleanedHtml}</div></body></html>`;
}

function updateContent() {
  const host = frame.value;
  if (!host) return;
  const bodyStyle = readBodyStyle(props.html);
  host.srcdoc = documentHtml(props.html);
  host.onload = () => {
    const styled = host.contentDocument && host.contentDocument.querySelector('.shadow-content');
    if (styled && bodyStyle) styled.style.cssText = bodyStyle;
    fit();
  };
}

function fit() {
  const host = frame.value;
  const parent = contentBox.value;
  const doc = host && host.contentDocument;
  const content = doc && doc.querySelector('.shadow-content');
  if (!host || !parent || !content) return;
  const parentWidth = parent.clientWidth || 1;
  const childWidth = content.scrollWidth || parentWidth;
  const scale = childWidth > parentWidth ? parentWidth / childWidth : 1;
  host.style.zoom = String(scale);
  const height = content.scrollHeight || doc.body.scrollHeight || 0;
  host.style.height = Math.max(Math.ceil(height * scale), 40) + 'px';
}

onMounted(() => {
  updateContent();
  window.addEventListener('resize', fit);
})

onUnmounted(() => {
  window.removeEventListener('resize', fit);
})

watch(() => props.html, () => {
  updateContent();
})
</script>

<style scoped>
.content-box {
  width: 100%;
  overflow: hidden;
  font-family: Inter, "Helvetica Neue", Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", Arial, sans-serif;
}

.content-html {
  width: 100%;
  border: 0;
  display: block;
  background: transparent;
}
</style>
