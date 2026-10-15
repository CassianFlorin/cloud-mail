<template>
  <div class="box">
    <div class="header-actions">
      <Icon class="icon" icon="material-symbols-light:arrow-back-ios-new" width="20" height="20" @click="handleBack"/>
      <Icon v-perm="'email:delete'" class="icon" icon="uiw:delete" width="16" height="16" @click="handleDelete"/>
      <span class="star" v-if="emailStore.contentData.showStar">
        <Icon class="icon" @click="changeStar" v-if="email.isStar" icon="fluent-color:star-16" width="20" height="20"/>
        <Icon class="icon" @click="changeStar" v-else icon="solar:star-line-duotone" width="18" height="18"/>
      </span>
      <Icon class="icon" v-if="emailStore.contentData.showReply" v-perm="'email:send'"  @click="openReply" icon="la:reply" width="21" height="21" />
      <Icon class="icon" v-if="emailStore.contentData.showReply" v-perm="'email:send'"  @click="openForward" icon="iconoir:arrow-up-right" width="20" height="20" />
      <el-button v-if="canClaim" size="small" @click="openClaim">{{ t('claimMail') }}</el-button>
    </div>
    <div></div>
    <el-scrollbar class="scrollbar">
      <div class="container">
        <div class="email-title">
          {{ email.subject }}
        </div>
        <div class="content">
          <div class="email-info">
            <div>
              <div class="send"><span class="send-source">{{$t('from')}}</span>
                <div class="send-name">
                  <span class="send-name-title">{{ email.name }}</span>
                  <span><{{ email.sendEmail }}></span>
                </div>
              </div>
              <div class="receive"><span class="source">{{$t('recipient')}}</span><span class="receive-email">{{  formateReceive(email.recipient) }}</span></div>
              <div class="date">
                <div>{{ formatDetailDate(email.createTime) }}</div>
              </div>
            </div>
            <el-alert v-if="email.status === 3" :closable="false" :title="toMessage(email.message)" class="email-msg" type="error" show-icon />
            <el-alert v-if="email.status === 4" :closable="false" :title="$t('complained')" class="email-msg" type="warning" show-icon />
            <el-alert v-if="email.status === 5" :closable="false" :title="$t('delayed')" class="email-msg" type="warning" show-icon />
          </div>
          <el-alert v-if="remoteBlocked > 0" class="track-alert" type="info" :closable="false" show-icon
                    :title="t('remoteBlocked', { count: remoteBlocked })">
            <div class="track-actions">
              <el-button link type="primary" @click="showRemoteImages">{{ t('showRemoteImages') }}</el-button>
              <el-button link type="primary" @click="openIntercept">{{ t('interceptView') }}</el-button>
            </div>
          </el-alert>
          <p v-else-if="email.content && interceptReady" class="track-note">
            <span>{{ findings.length ? t('interceptSummary', { count: findings.length }) : t('interceptNone') }}</span>
            <el-button v-if="findings.length" link type="primary" @click="openIntercept">{{ t('interceptView') }}</el-button>
          </p>
          <el-scrollbar class="htm-scrollbar" :class="!email.attList?.length ? 'bottom-distance' : ''">
            <ShadowHtml class="shadow-html" :html="privateContent" v-if="email.content" />
            <pre v-else class="email-text" >{{email.text}}</pre>
          </el-scrollbar>
          <div class="att" v-if="email.attList?.length > 0">
            <div class="att-title">
              <span>{{$t('attachments')}}</span>
              <span>{{$t('attCount',{total: email.attList.length})}}</span>
            </div>
            <div class="att-box">

              <div class="att-item" v-for="att in email.attList" :key="att.attId">
                <div class="att-icon" @click="showImage(att.key)">
                  <Icon v-bind="getIconByName(att.filename)" />
                </div>
                <div class="att-name" @click="showImage(att.key)">
                  {{ att.filename }}
                </div>
                <div class="att-size">{{ formatBytes(att.size) }}</div>
                <div class="opt-icon att-icon">
                  <Icon v-if="isImage(att.filename)" icon="hugeicons:view" width="22" height="22" @click="showImage(att.key)"/>
                  <a href="#" @click.prevent="downloadAttachment(att)">
                    <Icon icon="system-uicons:push-down" width="22" height="22"/>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </el-scrollbar>
    <el-image-viewer
        v-if="showPreview"
        :url-list="srcList"
        show-progress
        @close="showPreview = false"
    />
    <el-dialog v-model="interceptVisible" :title="interceptTitle" width="min(560px, 92vw)">
      <p v-if="!findings.length" class="intercept-empty">{{ t('interceptNone') }}</p>
      <div v-else class="intercept-list">
        <p class="intercept-lead">{{ t('interceptLead') }}</p>
        <section v-for="group in interceptGroups" :key="group.kind">
          <h4>{{ group.label }}</h4>
          <ul>
            <li v-for="(item, index) in group.items" :key="group.kind + index">
              <div v-if="interceptItemTitle(item)" class="intercept-name">{{ interceptItemTitle(item) }}</div>
              <div v-if="item.kind === 'link'" class="intercept-url">{{ t('interceptLinkTo') }} {{ item.url }}</div>
              <div v-else-if="item.url" class="intercept-url">{{ item.url }}</div>
              <div v-if="item.text" class="intercept-text">{{ item.text }}</div>
            </li>
          </ul>
        </section>
        <p v-if="interceptOmitted" class="intercept-more">{{ t('interceptMore', { count: interceptOmitted }) }}</p>
      </div>
    </el-dialog>
    <el-dialog v-model="claimVisible" :title="t('claimMail')" width="min(420px, 92vw)"
               :close-on-click-modal="!claimSaving" :close-on-press-escape="!claimSaving"
               :show-close="!claimSaving" :before-close="closeClaim">
      <div v-loading="claimLoading" class="claim-form">
        <p>{{ t('claimDescription') }}</p>
        <p>{{ t('recipient') }}：{{ claimRecipient }}</p>
        <el-select v-if="claimTargets.length" v-model="claimAccountId" :placeholder="t('claimSelectAccount')">
          <el-option v-for="target in claimTargets" :key="target.accountId"
                     :label="target.email + ' — ' + target.userEmail" :value="target.accountId"/>
        </el-select>
        <el-alert v-else-if="!claimLoading" :title="t('claimCreateFirst')" type="info" :closable="false"/>
      </div>
      <template #footer>
        <el-button :disabled="claimSaving || claimLoading" @click="loadClaimTargets">{{ t('claimReload') }}</el-button>
        <el-button :disabled="claimSaving" @click="claimVisible = false">{{ t('cancel') }}</el-button>
        <el-button type="primary" :loading="claimSaving" :disabled="!claimAccountId || claimLoading"
                   @click="submitClaim">{{ t('confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<script setup>
import ShadowHtml from '@/components/shadow-html/index.vue'
import {computed, reactive, ref, watch, onMounted, onUnmounted} from "vue";
import {useRouter} from 'vue-router'
import {ElMessage, ElMessageBox} from 'element-plus'
import {emailDelete, emailRead} from "@/request/email.js";
import {Icon} from "@iconify/vue";
import {useEmailStore} from "@/store/email.js";
import {useAccountStore} from "@/store/account.js";
import {formatDetailDate} from "@/utils/day.js";
import {starAdd, starCancel} from "@/request/star.js";
import {getExtName, formatBytes} from "@/utils/file-utils.js";
import {toOssDomain} from "@/utils/convert.js";
import {getIconByName} from "@/utils/icon-utils.js";
import {useSettingStore} from "@/store/setting.js";
import {allEmailDelete, claimAccounts, claimEmail} from "@/request/all-email.js";
import {useUserStore} from "@/store/user.js";
import {useUiStore} from "@/store/ui.js";
import {useI18n} from "vue-i18n";
import {EmailUnreadEnum} from "@/enums/email-enum.js";
import {fetchAttachmentBlob} from "@/utils/private-attachments.js";
import {protectEmailDocument} from "@shared/anti-track.js";

const uiStore = useUiStore();
const settingStore = useSettingStore();
const accountStore = useAccountStore();
const emailStore = useEmailStore();
const router = useRouter()
const email = computed(() => emailStore.contentData.email || {
  emailId: 0,
  attList: [],
  content: '',
  text: '',
  recipient: '[]',
})
const showPreview = ref(false)
const srcList = reactive([])
const privateContent = ref('');
const remoteBlocked = ref(0);
const findings = ref([]);
const interceptOmitted = ref(0);
const interceptReady = ref(false);
const interceptVisible = ref(false);
const remoteAllowedId = ref(null);
let interceptEmailId = 0;
let interceptTrack = true;
let interceptContent = '';
const objectUrls = new Map();
let contentRevision = 0;

function showRemoteImages() {
  remoteAllowedId.value = email.value.emailId;
}

function attachmentOrigins() {
  const origins = [];
  const domain = toOssDomain(settingStore.settings.r2Domain);
  if (domain) {
    try {
      origins.push(new URL(domain).origin);
    } catch {
      // 配置了无法解析的访问域名时，只信任当前站点上的附件。
    }
  }
  origins.push(window.location.origin);
  return origins;
}

function releaseObjectUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

async function attachmentUrl(key) {
  if (objectUrls.has(key)) return objectUrls.get(key);
  const revision = contentRevision;
  const blob = await fetchAttachmentBlob(key);
  if (revision !== contentRevision) throw new Error('Email changed');
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  return url;
}

// Load stored inline images with the session header, then expose only local
// blob URLs to the HTML renderer. Never insert bearer tokens into image URLs.
watch(() => [email.value.emailId, email.value.content, settingStore.blockTrackers, remoteAllowedId.value], async () => {
  const revision = ++contentRevision;
  const content = email.value.content || '';
  const track = settingStore.blockTrackers !== false;
  const reportChanged = interceptEmailId !== email.value.emailId || interceptTrack !== track || interceptContent !== content;
  if (reportChanged) {
    if (interceptEmailId !== email.value.emailId) interceptVisible.value = false;
    findings.value = [];
    interceptOmitted.value = 0;
    remoteBlocked.value = 0;
    interceptReady.value = false;
  }
  releaseObjectUrls();
  privateContent.value = '';
  const document = new DOMParser().parseFromString(formatImage(email.value.content), 'text/html');
  const images = [...document.querySelectorAll('img')];
  await Promise.all(images.map(async image => {
    const src = image.getAttribute('src') || '';
    const domain = toOssDomain(settingStore.settings.r2Domain);
    // Existing messages can use either a relative key or the configured
    // Worker website origin. Both must use authenticated blob reads.
    const prefix = domain && src.startsWith(domain + '/attachments/')
      ? domain + '/' : window.location.origin + '/';
    const relative = src.startsWith(prefix) ? src.slice(prefix.length) : src;
    const path = relative.replace(/^\/?attachments\//, 'attachments/');
    if (!path.startsWith('attachments/')) return;
    image.removeAttribute('src');
    try {
      image.setAttribute('src', await attachmentUrl(path));
    } catch {
      // Keep the email readable when one stored image is unavailable.
    }
  }));
  // 附件已换成会话内的 blob 地址，剩下的远程地址才会被当成追踪内容。
  // 脚本和事件代码与开关无关，关掉追踪时也要清掉。
  const blockRemote = track && remoteAllowedId.value !== email.value.emailId;
  const stats = protectEmailDocument(document, {
    blockRemote,
    stripPixels: track,
    rewriteLinks: track,
    trustedOrigins: attachmentOrigins(),
  });
  if (revision === contentRevision) {
    remoteBlocked.value = blockRemote ? stats.blockedRemote : 0;
    // 仍然显示会再跑一遍清理。拦截清单保留打开这封邮件时的结果。
    if (reportChanged) {
      interceptEmailId = email.value.emailId;
      interceptTrack = track;
      interceptContent = content;
      findings.value = stats.findings;
      interceptOmitted.value = stats.omitted;
      interceptReady.value = true;
    }
  }
  // Keep the original body styles and head styles used by HTML email layouts.
  if (revision === contentRevision) privateContent.value = document.documentElement.outerHTML;
}, { immediate: true });

const { t, te } = useI18n()
const INTERCEPT_ORDER = ['active', 'pixel', 'stylesheet', 'import', 'font', 'remote', 'link'];

const interceptGroups = computed(() => {
  const buckets = new Map();
  for (const item of findings.value) {
    if (!buckets.has(item.kind)) buckets.set(item.kind, []);
    buckets.get(item.kind).push(item);
  }
  const kinds = [
    ...INTERCEPT_ORDER.filter(kind => buckets.has(kind)),
    ...[...buckets.keys()].filter(kind => !INTERCEPT_ORDER.includes(kind)),
  ];
  return kinds.map(kind => ({
    kind,
    label: te('interceptGroups.' + kind) ? t('interceptGroups.' + kind) : kind,
    items: buckets.get(kind),
  }));
});

const interceptTitle = computed(() => findings.value.length
  ? t('interceptTitleCount', { count: findings.value.length })
  : t('interceptTitle'));

function interceptNameKey(name) {
  return String(name || '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function interceptItemTitle(item) {
  if (item.kind === 'link') return item.from || '';
  if (item.kind !== 'active') return '';
  if (item.target && item.name) return t('interceptHandler', { target: item.target, name: item.name });
  const key = interceptNameKey(item.name);
  if (key && te('interceptNames.' + key)) return t('interceptNames.' + key);
  return item.name || '';
}

function openIntercept() {
  interceptVisible.value = true;
}
const userStore = useUserStore();
// The backend also checks the administrator identity; this only controls visibility.
const canClaim = computed(() => userStore.user.permKeys?.includes('*')
    && emailStore.contentData.delType === 'physics'
    && email.value.status === 7 && email.value.type === 0 && email.value.isDel === 0);
const claimVisible = ref(false);
const claimLoading = ref(false);
const claimSaving = ref(false);
const claimRecipient = ref('');
const claimTargets = ref([]);
const claimAccountId = ref(null);
let claimEmailId = 0;

function closeClaim(done) {
  if (!claimSaving.value) done();
}

async function loadClaimTargets() {
  claimLoading.value = true;
  claimTargets.value = [];
  claimAccountId.value = null;
  try {
    const data = await claimAccounts(claimEmailId);
    claimRecipient.value = data.toEmail;
    claimTargets.value = data.accounts;
    if (data.accounts.length === 1) claimAccountId.value = data.accounts[0].accountId;
  } catch {
    // The shared request interceptor displays permission or stale-mail errors.
    claimVisible.value = false;
  } finally {
    claimLoading.value = false;
  }
}

async function openClaim() {
  claimEmailId = email.value.emailId;
  claimRecipient.value = email.value.toEmail || '';
  claimVisible.value = true;
  await loadClaimTargets();
}

async function submitClaim() {
  if (claimSaving.value || !claimAccountId.value) return;
  claimSaving.value = true;
  try {
    const updated = await claimEmail(claimEmailId, claimAccountId.value);
    // Invalidate cached ownership so returning to the old list cannot show stale data.
    delete emailStore.detailMap[claimEmailId];
    Object.assign(email.value, updated);
    emailStore.claimRevision++;
    claimVisible.value = false;
    ElMessage.success(t('claimSuccess'));
    router.back();
  } catch {
    // Keep the dialog open so the administrator can reload or cancel after a conflict.
  } finally {
    claimSaving.value = false;
  }
}

watch(() => accountStore.currentAccountId, () => {
  handleBack()
})

let readRequesting = false

function tryMarkRead() {
  if (!emailStore.contentData.showUnread || readRequesting) return
  const current = email.value
  if (!current?.emailId || current.unread !== EmailUnreadEnum.UNREAD) return

  // 等详情数据就绪（detailMap 已写入，或正文已有内容）再标已读
  const full = emailStore.detailMap[current.emailId]
  const detailReady = !!full || !!(current.content || current.text)
  if (!detailReady) return

  readRequesting = true
  const emailId = current.emailId
  current.unread = EmailUnreadEnum.READ
  if (emailStore.detailMap[emailId]) {
    emailStore.detailMap[emailId].unread = EmailUnreadEnum.READ
  }
  emailStore.markListRead(emailId)
  emailRead([emailId]).finally(() => {
    readRequesting = false
  })
}

watch(
  () => [
    email.value?.emailId,
    email.value?.content,
    email.value?.text,
    emailStore.detailMap[email.value?.emailId]
  ],
  () => tryMarkRead(),
  { flush: 'post' }
)

onMounted(() => {
  tryMarkRead()
  window.addEventListener('keydown', handleKeyDown);
})

onUnmounted(() => {
  contentRevision++;
  releaseObjectUrls();
  emailStore.contentData.showUnread = false;
  readRequesting = false
  window.removeEventListener('keydown', handleKeyDown);
})

function handleKeyDown(event) {
  if (event.key !== 'Escape') return;
  if (showPreview.value) return;
  if (claimVisible.value || interceptVisible.value) return;
  if (document.querySelector('.el-message-box')) return;
  const writeBox = document.querySelector('.write-box');
  if (writeBox && writeBox.offsetParent !== null) return;
  handleBack();
}

function openReply() {
  uiStore.writerRef.openReply(email.value)
}

function openForward() {
  uiStore.writerRef.openForward(email.value)
}

function toMessage(message) {
  return  message ? JSON.parse(message).message : '';
}

function formatImage(content) {
  content = content || '';
  const domain = settingStore.settings.r2Domain;
  return  content.replace(/{{domain}}/g, toOssDomain(domain) + '/');
}

async function showImage(key) {
  if (!isImage(key)) return;
  try {
    const url = await attachmentUrl(key);
    srcList.length = 0
    srcList.push(url)
    showPreview.value = true
  } catch {
    ElMessage.error(t('reqFailErrorMsg'));
  }
}

async function downloadAttachment(att) {
  try {
    const url = await attachmentUrl(att.key);
    const link = document.createElement('a');
    link.href = url;
    link.download = att.filename || 'attachment';
    link.click();
  } catch {
    ElMessage.error(t('reqFailErrorMsg'));
  }
}
function isImage(filename) {
  return ['png', 'jpg', 'jpeg', 'bmp', 'gif','jfif'].includes(getExtName(filename))
}

function formateReceive(recipient) {
  if (!recipient) return ''
  recipient = JSON.parse(recipient)
  return recipient.map(item => item.address).join(', ')
}

function changeStar() {
  if (email.value.isStar) {
    email.value.isStar = 0;
    starCancel(email.value.emailId).then(() => {
      email.value.isStar = 0;
      emailStore.cancelStarEmailId = email.value.emailId
      setTimeout(() => emailStore.cancelStarEmailId = 0)
      emailStore.starScroll?.deleteEmail([email.value.emailId])
    }).catch((e) => {
      console.error(e)
      email.value.isStar = 1;
    })
  } else {
    email.value.isStar = 1;
    starAdd(email.value.emailId).then(() => {
      email.value.isStar = 1;
      emailStore.addStarEmailId = email.value.emailId
      setTimeout(() => emailStore.addStarEmailId = 0)
      emailStore.starScroll?.addItem(email.value)
    }).catch((e) => {
      console.error(e)
      email.value.isStar = 0;
    })
  }
}

const handleBack = () => {
  router.back()
}

const handleDelete = () => {
  ElMessageBox.confirm(t('delEmailConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    if (emailStore.contentData.delType === 'logic') {
      emailDelete(email.value.emailId).then(() => {
        ElMessage({
          message: t('delSuccessMsg'),
          type: 'success',
          plain: true,
        })
        emailStore.deleteIds = [email.value.emailId]
      })
    } else  {

      allEmailDelete(email.value.emailId).then(() => {
        ElMessage({
          message: t('delSuccessMsg'),
          type: 'success',
          plain: true,
        })
        emailStore.deleteIds = [email.value.emailId]
      })
    }

    router.back()
  })
}
</script>
<style scoped lang="scss">
.claim-form {
  min-height: 110px;
  overflow-wrap: anywhere;
  .el-select { width: 100%; }
}

.box {
  height: 100%;
  overflow: hidden;
}

.header-actions {
  padding: 9px 15px 8px;
  display: flex;
  align-items: center;
  gap: 20px;
  box-shadow: var(--header-actions-border);
  font-size: 18px;
  .star {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 21px;
  }
  .icon {
    cursor: pointer;
  }
}


.scrollbar {
  height: calc(100% - 38px);
  width: 100%;
}

.container {
  font-size: 14px;
  padding-left: 20px;
  padding-right: 20px;
  padding-top: 10px;
  @media (max-width: 1023px) {
    padding-left: 15px;
    padding-right: 15px;
  }

  .email-title {
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 10px;
  }

  .htm-scrollbar {
  }

  .content {
    display: flex;
    flex-direction: column;

    .att {
      margin-top: 30px;
      margin-bottom: 30px;
      border: 1px solid var(--light-border-color);
      padding: 14px;
      border-radius: 6px;
      width: fit-content;
      .att-box {
        min-width: min(410px,calc(100vw - 60px));
        max-width: 600px;
        display: grid;
        gap: 12px;
        grid-template-rows: 1fr;
      }

      .att-title {
        margin-bottom: 8px;
        display: flex;
        justify-content: space-between;
        span:first-child {
          font-weight: bold;
        }
      }

      .att-item {
        cursor: pointer;
        div {
          align-self: center;
        }
        background: var(--light-ill);
        padding: 5px 7px;
        border-radius: 4px;
        align-self: start;
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        .att-icon {
          display: grid;
        }

        .att-size {
          color: var(--secondary-text-color);
        }

        .att-name {
          margin-left: 8px;
          margin-right: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          word-break: break-all;
        }

        .att-image {
          width: 60px;
          height: 60px;
          object-fit: contain;
        }

        .opt-icon {
          padding-left: 10px;
          color: var(--secondary-text-color);
          align-items: center;
          display: flex;
          gap: 8px;
          cursor: pointer;
          a {
            color: var(--secondary-text-color);
            align-items: center;
            display: flex;
          }
        }
      }
    }

    .email-info {

      border-bottom: 1px solid var(--light-border-color);
      margin-bottom: 20px;
      padding-bottom: 8px;
      @media (max-width: 1024px) {
        margin-bottom: 15px;
      }
      .date {
        color: var(--regular-text-color);
        margin-bottom: 6px;
      }

      .email-msg {
        max-width: 400px;
        width: fit-content;
        margin-bottom: 15px;
      }

      .send {
        display: flex;
        margin-bottom: 6px;

        .send-name {
          color: var(--regular-text-color);
          display: flex;
          flex-wrap: wrap;
        }

        .send-name-title {
          padding-right: 5px;
        }
      }

      .receive {
        margin-bottom: 6px;
        display: flex;
        .receive-email {
          max-width: 700px;
          word-break: break-word;
        }
        span:nth-child(2) {
          color: var(--regular-text-color);
        }
      }

      .send-source {
        white-space: nowrap;
        font-weight: bold;
        padding-right: 10px;
      }

      .source {
        white-space: nowrap;
        font-weight: bold;
        padding-right: 10px;
      }
    }
  }
}

.track-alert {
  margin-bottom: 12px;
}

.track-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.track-note {
  margin: 0 0 12px;
  color: var(--regular-text-color);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.intercept-lead,
.intercept-empty,
.intercept-more {
  margin: 0 0 12px;
}

.intercept-list {
  max-height: 60vh;
  overflow: auto;

  section + section {
    margin-top: 14px;
  }

  h4 {
    margin: 0 0 6px;
    font-size: 13px;
  }

  ul {
    margin: 0;
    padding-left: 18px;
  }

  li {
    margin-bottom: 8px;
    overflow-wrap: anywhere;
  }

  .intercept-url,
  .intercept-text {
    color: var(--regular-text-color);
  }
}

.shadow-html::after  {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--message-block-color); /* 半透明黑色蒙层 */
  pointer-events: none; /* 不影响点击 */
}

.email-text {
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.bottom-distance {
  margin-bottom: 30px;
}


</style>
