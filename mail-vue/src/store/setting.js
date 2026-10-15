import { defineStore } from 'pinia'

export const useSettingStore = defineStore('setting', {
    state: () => ({
        domainList: [],
        settings: {
            r2Domain: '',
            loginOpacity: 1.00,
        },
        lang: '',
        // 阅读时默认不加载远程内容。旧的本地设置没有这一项时也保持开启。
        blockTrackers: true,
    }),
    actions: {

    },
    persist: {
        pick: ['lang', 'blockTrackers'],
    },
})
