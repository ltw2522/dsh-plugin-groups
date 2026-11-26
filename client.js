/**
 * 插件分类（浏览器半边）：在「插件」页的标签页列表里追加一个「分类」页签，
 * 把已装插件按「必要 / 在用 / 闲置可清理 / 异常」重新分组展示。
 *
 * 设计取舍：
 * - 不改 dsh-client-ui-plugin-manager 的已编译 bundle（升级会被覆盖、也没有可插入分区的插槽），
 *   只通过官方声明的 `plugins.tab` 插槽贡献一个自己的页签；
 * - 数据仍然走官方 `pluginManager/listBundles`、`pluginManager/setBundleEnabled` 两个 Remote 方法，
 *   所以本页看到的开关状态与内置「已安装」页完全一致；
 * - 分组判据取 BundleInfo 的客观字段（installed / official / removable / enabled / readOnlyReason /
 *   availability），不猜、不维护第二份清单，插件装删后自动跟随。
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-groups',
  factory(require) {
    // React 由浏览器的模块表提供，这里只取需要的那几个 API。
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React

    /** 语言字典命名空间：与内置页的 pluginManager 并列，互不覆盖。 */
    const NS = 'pluginGroups'

    /** 简体中文文案。 */
    const zh = {
      tabLabel: '分类',
      title: '插件分类',
      intro: '按「必要性」重排已装插件：核心层不可关，自装的在用一个区，闲置的下次清理就从这个区删。',
      searchPlaceholder: '筛选插件名或包名',
      refresh: '刷新',
      summary: '共 {total} 个 · 核心 {core} · 在用 {installed} · 闲置 {idle}',
      empty: '没有可分类的插件。',
      filterEmpty: '没有匹配的插件。',
      loadFailed: '读取插件清单失败：{error}',
      working: '处理中…',
      sectionCore: '核心层 · 不可关',
      sectionCoreHint: 'DSH 运行底座，关掉会丢功能，也不可卸载',
      sectionInstalled: '自装 · 在用',
      sectionInstalledHint: '当前启用中的自装插件，可随时关闭或卸载',
      sectionIdle: '自装 · 闲置（建议清理）',
      sectionIdleHint: '已装但没启用，占磁盘不占内存，可关可卸',
      sectionOptional: '官方可选 · 已开',
      sectionOptionalHint: '随安装包提供、可开关但不可卸载',
      sectionBroken: '异常 · 需要处理',
      sectionBrokenHint: '文件缺失或加载报错',
      tagOfficial: '官方',
      tagSelf: '自装',
      tagLocked: '不可卸',
      tagMissing: '文件缺失',
      tagFailed: '加载失败',
      detail: '详情',
      switchOn: '停用 {name}',
      switchOff: '启用 {name}',
      lockedSwitch: '该插件由 DSH 安装包提供，不能在这里关闭',
      // 锁定相关：锁只拦「关闭」，不拦「开启」，避免把自己锁在门外。
      lockOn: '锁定：锁住后不能关闭，防止误关',
      lockOff: '解锁：解除关闭保护',
      lockedTag: '已锁',
      unlockFirst: '「{name}」已锁定，先点它左边的锁图标解锁，才能关闭',
      // 自定义分类（仿 Steam 游戏库的「设置分类」）：一个插件可以同时属于多个分类。
      viewNeed: '按必要性',
      viewCat: '我的分类',
      summaryCat: '共 {total} 个 · 已归类 {tagged} · 未分类 {untagged} · 分类 {cats} 个',
      catEmpty: '还没有自定义分类。点「新建分类」起一个（例如：必留 / 试验中 / 待删），再点每行右边的标签图标归类。',
      catNone: '未分类',
      catNoneHint: '还没归到任何自定义分类的插件',
      catHint: '自定义分类：一个插件可以同时属于多个分类',
      catNew: '新建分类',
      catNamePlaceholder: '分类名，如：必留 / 试验中 / 待删',
      catAdd: '添加',
      catAssign: '设置分类',
      catAssignTitle: '设置分类：{name}',
      catAssignHint: '勾选即保存；一个插件可以同时属于多个分类，再点一次取消。',
      catManage: '管理分类',
      catManageHint: '删除分类只删分组，不会关闭插件。',
      catRename: '重命名',
      catRemove: '删除',
      catClose: '关闭',
      catOnRow: '已归入 {n} 个分类',
      catTagOne: '按我的分类',
    }

    /** 英文文案：语言切到 en 时回退到这里。 */
    const en = {
      tabLabel: 'Groups',
      title: 'Plugin groups',
      intro: 'Regroup the installed plugins by necessity: core layers cannot be switched off, self-installed ones split into in-use and idle, and idle ones are the removal candidates.',
      searchPlaceholder: 'Filter by title or package name',
      refresh: 'Refresh',
      summary: '{total} total · {core} core · {installed} in use · {idle} idle',
      empty: 'Nothing to group.',
      filterEmpty: 'No plugin matches.',
      loadFailed: 'Could not read the plugin list: {error}',
      working: 'Working…',
      sectionCore: 'Core layers · locked on',
      sectionCoreHint: 'The DSH runtime base; switching it off loses capability, and it cannot be removed',
      sectionInstalled: 'Self-installed · in use',
      sectionInstalledHint: 'Enabled third-party bundles; either can be switched off or removed',
      sectionIdle: 'Self-installed · idle (cleanup candidates)',
      sectionIdleHint: 'Installed but switched off — disk only, removable',
      sectionOptional: 'Official optional · switched on',
      sectionOptionalHint: 'Shipped with DSH, switchable but not removable',
      sectionBroken: 'Broken · needs attention',
      sectionBrokenHint: 'Missing files or a failed load',
      tagOfficial: 'official',
      tagSelf: 'self',
      tagLocked: 'locked',
      tagMissing: 'missing files',
      tagFailed: 'load failed',
      detail: 'Details',
      switchOn: 'Disable {name}',
      switchOff: 'Enable {name}',
      lockedSwitch: 'Shipped with DSH and cannot be switched off here',
      lockOn: 'Lock: cannot be switched off while locked',
      lockOff: 'Unlock: remove the switch-off guard',
      lockedTag: 'locked',
      unlockFirst: '"{name}" is locked. Click the lock icon on its left first, then you can switch it off.',
      viewNeed: 'By necessity',
      viewCat: 'My categories',
      summaryCat: '{total} total · {tagged} categorised · {untagged} uncategorised · {cats} categories',
      catEmpty: 'No categories yet. Create one (e.g. keep / testing / to remove), then click the tag icon on a row to file it.',
      catNone: 'Uncategorised',
      catNoneHint: 'Plugins that are not in any custom category',
      catHint: 'Custom categories: a plugin can sit in several at once',
      catNew: 'New category',
      catNamePlaceholder: 'Category name, e.g. keep / testing / to remove',
      catAdd: 'Add',
      catAssign: 'Set categories',
      catAssignTitle: 'Categories for {name}',
      catAssignHint: 'A click saves immediately; a plugin can sit in several categories — click again to remove.',
      catManage: 'Manage categories',
      catManageHint: 'Deleting a category only removes the grouping, it never switches a plugin off.',
      catRename: 'Rename',
      catRemove: 'Delete',
      catClose: 'Close',
      catOnRow: 'In {n} categories',
      catTagOne: 'by my categories',
    }

    /**
     * 分区定义：顺序即页面顺序。
     * id 同时是折叠状态的键，hintKey 是该区的说明文案。
     */
    const SECTIONS = [
      { id: 'core', titleKey: 'sectionCore', hintKey: 'sectionCoreHint' },
      { id: 'installed', titleKey: 'sectionInstalled', hintKey: 'sectionInstalledHint' },
      { id: 'idle', titleKey: 'sectionIdle', hintKey: 'sectionIdleHint' },
      { id: 'optional', titleKey: 'sectionOptional', hintKey: 'sectionOptionalHint' },
      { id: 'broken', titleKey: 'sectionBroken', hintKey: 'sectionBrokenHint' },
    ]

    /** 组件内样式：用宿主主题 token，浅色/深色自动跟随；卸载即随组件消失。 */
    const CSS = `
.pg-page{display:flex;flex-direction:column;gap:14px;padding:18px 24px 44px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
.pg-head{display:flex;flex-direction:column;gap:4px}
.pg-title{margin:0;font-size:15px;font-weight:600}
.pg-intro{margin:0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.pg-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pg-search{flex:1 1 200px;min-width:140px;height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;outline:none}
.pg-search:focus{border-color:var(--dsw-alias-state-business-primary)}
.pg-btn{height:28px;padding:0 12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.pg-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.pg-btn[disabled]{opacity:.5;cursor:default}
.pg-count{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-left:auto}
.pg-group{display:flex;flex-direction:column;gap:8px}
.pg-group-head{display:flex;align-items:center;gap:8px;padding:3px 4px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;user-select:none}
.pg-group-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pg-group-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.pg-group-title{font-size:13px;font-weight:600}
.pg-group-num{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.pg-group-hint{margin:0 0 2px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.pg-chev{color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.pg-chev[data-open="1"]{transform:rotate(90deg)}
.pg-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pg-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.pg-row:hover{background:var(--dsw-alias-bg-layer-3)}
.pg-icon{width:26px;height:26px;flex:none;border-radius:6px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-3);overflow:hidden;color:var(--dsw-alias-label-tertiary)}
.pg-icon img{width:100%;height:100%;object-fit:contain}
.pg-icon-glyph{font-size:13px;font-weight:600;line-height:1}
.pg-main{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
.pg-name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pg-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pg-tags{display:flex;gap:4px;flex:none}
.pg-tag{padding:1px 6px;border-radius:4px;font-size:11px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.pg-tag[data-tone="ok"]{color:var(--dsw-alias-state-success-primary)}
.pg-tag[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.pg-tag[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.pg-switch{position:relative;flex:none;width:32px;height:18px;padding:0;border:0;border-radius:9px;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background .15s ease}
.pg-switch[aria-checked="true"]{background:var(--dsw-alias-state-business-primary)}
.pg-switch[disabled]{opacity:.45;cursor:default}
.pg-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .15s ease}
.pg-switch[aria-checked="true"] .pg-knob{transform:translateX(14px)}
.pg-empty{margin:0;padding:8px 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.pg-error{margin:0;font-size:12px;color:var(--dsw-alias-state-error-primary)}
/* 二级分组（自定义分类）：嵌在必要性分区下面，像一个可折叠的子文件夹 */
.pg-subs{display:flex;flex-direction:column;gap:10px}
.pg-sub{display:flex;flex-direction:column;gap:6px}
.pg-sub-head{display:flex;align-items:center;gap:7px;padding:2px 4px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer;user-select:none}
.pg-sub-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pg-sub-head:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
/* 色点：每个分类一个颜色，扫一眼就知道行属于哪个文件夹 */
.pg-dot{flex:none;width:8px;height:8px;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,.06) inset}
.pg-dot[data-none="1"]{background:transparent;border:1px dashed var(--dsw-alias-border-l3)}
.pg-sub-name{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.pg-sub-num{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pg-sub-chev{color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.pg-sub-chev[data-open="1"]{transform:rotate(90deg)}
/* 二级里的行缩进一点，视觉上才像「在文件夹里」 */
.pg-sub .pg-list{padding-left:18px}
/* 锁定插件：锁按钮 + 锁定行的浅色底 + 顶部提示条 */
/* 锁按钮：24×24 透明方块，未锁是灰开口锁，已锁转成橙色闭合锁 */
.pg-lock{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:color .15s ease,background .15s ease}
.pg-lock:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.pg-lock[data-locked="1"]{color:var(--dsw-alias-state-warn-primary)}
.pg-lock[data-locked="1"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pg-row[data-locked="1"]{background:var(--dsw-alias-bg-layer-3);border-color:var(--dsw-alias-border-l2)}
.pg-notice{display:flex;align-items:center;gap:8px;margin:0;padding:7px 10px;border-radius:6px;font-size:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-border-l2)}
.pg-notice-text{flex:1;min-width:0}
.pg-notice-x{flex:none;width:20px;height:20px;padding:0;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;line-height:1;cursor:pointer}
.pg-notice-x:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* 视图切换：必要性 / 我的分类，做成分段控件，当前态用底色区分 */
.pg-seg{display:inline-flex;flex:none;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-3);gap:2px}
.pg-seg-btn{height:24px;padding:0 10px;border:0;border-radius:5px;background:none;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}
.pg-seg-btn:hover{color:var(--dsw-alias-label-primary)}
.pg-seg-btn[data-on="1"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.06)}
/* 行内的分类按钮：和锁按钮同尺寸，保持右侧一整条图标带 */
.pg-cat{flex:none;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:color .15s ease,background .15s ease}
.pg-cat:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.pg-cat[data-filed="1"]{color:var(--dsw-alias-state-business-primary)}
/* 分类对话框：遮罩 + 居中卡片，点遮罩关闭 */
.pg-mask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28)}
.pg-dialog{width:min(420px,88vw);max-height:76vh;display:flex;flex-direction:column;gap:10px;padding:16px 18px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 12px 32px rgba(0,0,0,.24)}
.pg-dialog-title{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.pg-dialog-hint{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pg-dialog-list{display:flex;flex-direction:column;gap:4px;overflow:auto;padding:2px 0}
.pg-dialog-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3)}
.pg-dialog-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pg-dialog-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pg-dialog-num{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pg-dialog-foot{display:flex;align-items:center;gap:6px}
.pg-dialog-new{flex:1;min-width:0;height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:inherit;font:inherit;outline:none}
.pg-dialog-new:focus{border-color:var(--dsw-alias-state-business-primary)}
.pg-check{flex:none;width:15px;height:15px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}
.pg-dialog-empty{margin:0;padding:6px 0;font-size:12px;color:var(--dsw-alias-label-tertiary)}
`

    /**
     * 把一件 bundle 归到一个分区。
     * 判据全部来自 Host 报的字段，保持与内置「已安装」页的语义一致。
     * @param {object} bundle pluginManager/listBundles 的一项。
     * @returns {string|null} 分区 id；返回 null 表示这一项不进分类页（例如未启用的官方可选目录）。
     */
    function classify(bundle) {
      // 文件读不到、且本来在用或曾被启用：算异常，提醒处理。
      if (bundle.availability === 'missing' && (bundle.installed || bundle.enabled)) return 'broken'
      // 核心层：随安装包解析、不属 profile 依赖、不可卸、且当前确实在跑（dsh-base / dsh-web-app）。
      if (!bundle.installed && bundle.removable === false && bundle.official === false) {
        return bundle.enabled ? 'core' : null
      }
      // 官方可选（含实验性）：未装的情况下按开关分到「官方可选·已开」，关着的留在「实验性插件」页里，不重复列。
      if (bundle.official && !bundle.installed) return bundle.enabled ? 'optional' : null
      // profile 里声明的自装包：按开关分「在用 / 闲置」。
      if (bundle.installed || bundle.removable) return bundle.enabled ? 'installed' : 'idle'
      return null
    }

    /**
     * 拆开 Host 的 Result 信封。
     * Remote 方法一律返回 `{ ok: true, value }` 或 `{ ok: false, error: { code } }`，
     * 直接当数组用会静默拿到空结果，所以这里统一成「成功返回 value，失败抛错」。
     * @param {object} result Remote 的返回值。
     * @param {string} fallback 没有 code 时的兜底错误文本。
     * @returns {*} 信封里的 value。
     */
    function unwrap(result, fallback) {
      if (result !== null && typeof result === 'object' && result.ok === true) return result.value
      const error = result !== null && typeof result === 'object' ? result.error : undefined
      const code = error && (error.message || error.code)
      throw new Error(code === undefined || code === null || code === '' ? fallback : String(code))
    }

    /**
     * 锁定清单存在浏览器本地（localStorage），刷新页面锁还在。
     * 只存包名数组；读坏了就当没锁，绝不让一个坏字符串把整页拖垮。
     */
    // 锁定清单存浏览器本地；键名带版本，升版即丢弃旧版遗留数据（不影响插件本身）。
const LOCK_KEY = 'pluginGroups.locked.v2'
// 本插件的包名：它自己也在清单里，是最容易手滑关掉的一格。
const SELF_NAME = '@local/dsh-plugin-groups'
// 「已自动锁过一次」的标记，避免用户手动解锁后被强行锁回去。
const AUTO_KEY = 'pluginGroups.autoLockSelf.v1'

    function readLocks() {
      try {
        const raw = window.localStorage.getItem(LOCK_KEY)
        if (raw === null || raw === '') return []
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
      } catch (reason) {
        return []
      }
    }

    function writeLocks(list) {
      try {
        window.localStorage.setItem(LOCK_KEY, JSON.stringify(list))
      } catch (reason) {
        // 隐私模式 / 存储被禁用：锁只在本次挂载内有效，不报错打断操作。
      }
    }

    /**
     * 自定义分类：仿 Steam 游戏库的「设置分类」。
     * 形状是 { cats: [{ id, name }], map: { [包名]: [分类 id, ...] } }。
     * 一个插件可以同时属于多个分类；分类 id 只在本地有意义，不动 Host 侧任何状态。
     */
    // 键名带版本：升版即丢弃旧数据，不会因为旧结构把页面读崩。
    const CAT_KEY = 'pluginGroups.categories.v1'
    // 分类配色：8 个一组循环取，色相拉开，深色/浅色底上都能分辨。
    const CAT_COLORS = ['#4C8DFF', '#F5A524', '#2FBF71', '#E0526B', '#9B6BFF', '#12B5B0', '#C77D1A', '#7A8699']

    /** 取一个分类的颜色；越界或没存过就按序号兜底。 */
    function colorOf(cat, index) {
      const value = typeof cat.color === 'number' ? cat.color : index
      return CAT_COLORS[value % CAT_COLORS.length]
    }

    /** 读分类数据；任何一项形状不对就整份当空，宁可少显示也不要半坏半好。 */
    function readCats() {
      const empty = { cats: [], map: {} }
      try {
        const raw = window.localStorage.getItem(CAT_KEY)
        if (raw === null || raw === '') return empty
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return empty
        const cats = Array.isArray(parsed.cats)
          ? parsed.cats
            .filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string')
            .map((item, index) => ({
              id: item.id,
              name: typeof item.name === 'string' ? item.name : item.id,
              // 颜色存索引而不是色值：将来换调色板不用迁移旧数据。
              color: typeof item.color === 'number' ? item.color : index,
            }))
          : []
        const known = new Set(cats.map(item => item.id))
        const map = {}
        if (parsed.map !== null && typeof parsed.map === 'object') {
          for (const [pkg, list] of Object.entries(parsed.map)) {
            if (!Array.isArray(list)) continue
            // 只留还存在的分类 id，删分类后残留的引用在这里被自然清掉。
            const kept = list.filter(id => typeof id === 'string' && known.has(id))
            if (kept.length > 0) map[pkg] = kept
          }
        }
        return { cats, map }
      } catch (reason) {
        return empty
      }
    }

    /** 写分类数据；写失败（隐私模式）静默，界面在本次挂载内仍然可用。 */
    function writeCats(state) {
      try {
        window.localStorage.setItem(CAT_KEY, JSON.stringify(state))
      } catch (reason) {
        // 同 writeLocks：不打断操作。
      }
    }

    /** 生成一个不与现有分类冲突的 id。 */
    function nextCatId(cats) {
      let index = 1
      while (cats.some(item => item.id === `c${index}`)) index += 1
      return `c${index}`
    }

    /**
     * 首次运行把「插件分类」自己锁上：关掉自己这个页签就没了，是最容易手滑的一格。
     * 只做一次（AUTO_KEY 标记），用户手动解锁后不会再被强行锁回去。
     */
    function ensureSelfLocked(rows, apply) {
      let marked = false
      try {
        marked = window.localStorage.getItem(AUTO_KEY) === '1'
      } catch (reason) {
        marked = true   // 存储不可用就别折腾，当已处理
      }
      if (marked) return
      // 本插件不在清单里（已被禁用）时不写标记，等它下次被启用再补。
      const present = rows.some(row => row && row.name === SELF_NAME)
      if (!present) return
      apply((current) => {
        const next = current.indexOf(SELF_NAME) === -1 ? current.concat([SELF_NAME]) : current
        if (next !== current) writeLocks(next)
        try {
          window.localStorage.setItem(AUTO_KEY, '1')
        } catch (reason) {
          // 写不进去就下次再试，不影响当前这一屏
        }
        return next
      })
    }

    /** 取显示标题：优先本地化 meta.title，其次包名。 */
    function titleOf(bundle, resolveText) {
      const meta = bundle.meta
      if (meta && meta.title !== undefined) {
        const text = resolveText(meta.title)
        if (typeof text === 'string' && text.trim() !== '') return text
      }
      return bundle.name
    }

    /** 开关是否可点：Host 明确不给管理时置灰。 */
    function switchable(bundle) {
      return bundle.readOnlyReason === undefined && bundle.removable !== false
    }

    /** 行内标签：官方/自装 + 不可卸 + 文件缺失 + 加载失败。 */
    function tagsOf(bundle, tr) {
      const tags = []
      if (bundle.official) tags.push({ text: tr('tagOfficial'), tone: 'ok' })
      else if (bundle.installed) tags.push({ text: tr('tagSelf'), tone: undefined })
      if (bundle.removable === false) tags.push({ text: tr('tagLocked'), tone: undefined })
      if (bundle.availability === 'missing') tags.push({ text: tr('tagMissing'), tone: 'warn' })
      if (bundle.error !== undefined) tags.push({ text: tr('tagFailed'), tone: 'error' })
      return tags
    }

    /**
     * 行首图标：包清单里带 base64 图就用它，没带就用「首字母色块」兜底。
     * 兜底色从名字算哈希挑一组，同一个插件每次刷新颜色一致，不会闪。
     */
    function BundleIcon({ bundle, title }) {
      const icon = bundle.meta && bundle.meta.icon
      if (typeof icon === 'string' && icon !== '') {
        return h('span', { className: 'pg-icon', 'aria-hidden': true },
          h('img', { src: icon, width: 26, height: 26, alt: '' }))
      }
      // 取首字：去掉 @scope/ 前缀再取第一个字符，中文取第一个汉字，英文取首字母。
      const raw = title.trim()
      const tail = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw.replace(/^@/, '')
      const glyph = (tail.trim()[0] || '?').toUpperCase()
      let hash = 0
      for (let index = 0; index < bundle.name.length; index += 1) {
        hash = (hash * 31 + bundle.name.charCodeAt(index)) % 360
      }
      return h('span', {
        className: 'pg-icon pg-icon-glyph',
        'aria-hidden': true,
        style: { background: `hsl(${hash} 62% 92%)`, color: `hsl(${hash} 46% 34%)` },
      }, glyph)
    }

    /**
     * 一件插件的行：图标、标题、包名与版本、标签、锁、开关、详情。
     * 锁只拦「关闭」这一侧，开回来永远允许，免得把自己锁在门外。
     */
    function BundleRow({ bundle, tr, resolveText, busy, locked, onLock, onCats, catCount, onToggle, onOpen }) {
      const title = titleOf(bundle, resolveText)
      const description = bundle.meta && bundle.meta.description !== undefined
        ? resolveText(bundle.meta.description)
        : (typeof bundle.description === 'string' ? bundle.description : '')
      const version = bundle.version === undefined ? '' : ` · v${bundle.version}`
      const allowed = switchable(bundle)
      // 不可卸载的行（核心层、官方可选）开关本来就置灰，再摆一个锁只添噪音。
      const lockable = bundle.removable !== false
      // 分类标签同理：系统自带的插件不该进自定义收藏夹，否则「必留」里混进 dsh-base 毫无意义。
      const taggable = bundle.removable !== false
      const action = bundle.enabled ? tr('switchOn', { name: title }) : tr('switchOff', { name: title })
      // 锁定提示优先于普通标题：让人一眼看出为什么点了没反应。
      const switchTitle = !allowed ? tr('lockedSwitch') : (locked && bundle.enabled ? tr('unlockFirst', { name: title }) : action)
      return h('li', {
        className: 'pg-row',
        'data-pg-row': bundle.name,
        'data-locked': locked && lockable ? '1' : '0',
      },
        h(BundleIcon, { bundle, title }),
        h('div', { className: 'pg-main' },
          h('span', { className: 'pg-name', title: `${title}${version}` }, title),
          h('span', { className: 'pg-sub', title: description === '' ? bundle.name : description },
            `${bundle.name}${version}`)),
        h('div', { className: 'pg-tags' },
          tagsOf(bundle, tr).map((tag, index) => h('span', {
            key: `tag-${index}`, className: 'pg-tag',
            ...(tag.tone === undefined ? {} : { 'data-tone': tag.tone }),
          }, tag.text)),
          locked && lockable ? h('span', { className: 'pg-tag', 'data-tone': 'warn' }, tr('lockedTag')) : null),
        // 分类按钮：打开「设置分类」对话框。已归类的用主题色点出来，一眼能看出哪些还没归。
        // 不可卸载的插件不渲染这个按钮——它们不进收藏夹。
        taggable ? h('button', {
          type: 'button',
          className: 'pg-cat',
          'data-pg-cats': bundle.name,
          'data-filed': catCount > 0 ? '1' : '0',
          'aria-label': catCount > 0 ? tr('catOnRow', { n: String(catCount) }) : tr('catAssign'),
          title: catCount > 0 ? tr('catOnRow', { n: String(catCount) }) : tr('catAssign'),
          onClick: () => { onCats(bundle) },
        },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: 'M8.4 2.6H4.2A1.6 1.6 0 0 0 2.6 4.2v4.2l6.4 6.4 5.6-5.6-6.2-6.6z',
            stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round',
          }),
          h('circle', { cx: 5.6, cy: 5.6, r: 1.1, fill: 'currentColor' }))) : null,
        lockable ? h('button', {
          type: 'button',
          className: 'pg-lock',
          'data-pg-lock': bundle.name,
          'data-locked': locked ? '1' : '0',
          'aria-pressed': locked ? 'true' : 'false',
          'aria-label': locked ? tr('lockOff') : tr('lockOn'),
          title: locked ? tr('lockOff') : tr('lockOn'),
          onClick: () => { onLock(bundle.name) },
        },
        h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('path', {
            d: locked ? 'M5.5 7.2V5.2a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7.2V5.2a2.5 2.5 0 0 1 5 0',
            stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
          }),
          h('rect', {
            x: 3.5, y: 7.2, width: 9, height: 6.3, rx: 1.5,
            stroke: 'currentColor', strokeWidth: 1.5,
          }))) : null,
        h('button', {
          type: 'button',
          className: 'pg-btn',
          'data-pg-open': bundle.name,
          onClick: () => { onOpen(bundle.name) },
        }, tr('detail')),
        h('button', {
          type: 'button',
          role: 'switch',
          className: 'pg-switch',
          'aria-checked': bundle.enabled ? 'true' : 'false',
          'aria-label': switchTitle,
          title: switchTitle,
          disabled: !allowed || busy === true,
          'data-pg-switch': bundle.name,
          onClick: () => { onToggle(bundle, !bundle.enabled) },
        }, h('span', { className: 'pg-knob' })))
    }

    /**
     * 分类对话框：两种模式共用一套壳。
     * - mode='assign'：给一件插件勾选所属分类（bundle 有值，勾选立刻落盘）。
     * - mode='manage'：管理分类本身（改名、删除、新建）。
     * 不需要「保存」按钮：勾选即生效，少一次状态同步，也不会出现「点了取消但已经改了一半」的情况。
     */
    function CatDialog({ tr, mode, bundle, bundleTitle, state, counts, onToggle, onCreate, onRename, onRemove, onClose }) {
      const [draft, setDraft] = useState('')
      // 管理模式下正在改名的那一行（{ id, text }），null 表示没有在改。
      const [renaming, setRenaming] = useState(null)
      const mine = bundle === null ? [] : (state.map[bundle.name] || [])

      /** 新建：名字去掉首尾空白后非空才算数，成功后清空输入框。 */
      const submitNew = () => {
        const name = draft.trim()
        if (name === '') return
        onCreate(name)
        setDraft('')
      }

      /** 改名提交：同样要求非空；空名视为放弃。 */
      const submitRename = () => {
        if (renaming === null) return
        const name = renaming.text.trim()
        if (name !== '') onRename(renaming.id, name)
        setRenaming(null)
      }

      return h('div', {
        className: 'pg-mask',
        'data-pg-mask': mode,
        // 点遮罩空白处关闭；卡片内部的点击要拦住，否则勾一下就关掉了。
        onClick: onClose,
      },
      h('div', {
        className: 'pg-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        onClick: (event) => { event.stopPropagation() },
      },
      h('h3', { className: 'pg-dialog-title' },
        mode === 'assign' ? tr('catAssignTitle', { name: bundleTitle }) : tr('catManage')),
      h('p', { className: 'pg-dialog-hint' }, mode === 'assign' ? tr('catAssignHint') : tr('catManageHint')),
      h('div', { className: 'pg-dialog-list' },
        state.cats.length === 0
          ? h('p', { className: 'pg-dialog-empty' }, tr('catEmpty'))
          : state.cats.map((cat) => {
            // 正在改名的行换成输入框，回车或失焦提交。
            if (renaming !== null && renaming.id === cat.id) {
              return h('div', { className: 'pg-dialog-row', key: cat.id },
                h('input', {
                  className: 'pg-dialog-new',
                  value: renaming.text,
                  autoFocus: true,
                  onChange: (event) => { setRenaming({ id: cat.id, text: event.target.value }) },
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') submitRename()
                    if (event.key === 'Escape') setRenaming(null)
                  },
                  onBlur: submitRename,
                }))
            }
            const checked = mine.includes(cat.id)
            return h('div', { className: 'pg-dialog-row', key: cat.id },
              mode === 'assign'
                ? h('input', {
                  type: 'checkbox',
                  className: 'pg-check',
                  checked,
                  'data-pg-check': `${bundle.name}|${cat.id}`,
                  onChange: () => { onToggle(bundle.name, cat.id) },
                })
                : null,
              h('span', { className: 'pg-dialog-name' }, cat.name),
              h('span', { className: 'pg-dialog-num' }, String(counts[cat.id] || 0)),
              mode === 'manage'
                ? h('button', {
                  type: 'button',
                  className: 'pg-btn',
                  onClick: () => { setRenaming({ id: cat.id, text: cat.name }) },
                }, tr('catRename'))
                : null,
              mode === 'manage'
                ? h('button', {
                  type: 'button',
                  className: 'pg-btn',
                  onClick: () => { onRemove(cat.id) },
                }, tr('catRemove'))
                : null)
          })),
      h('div', { className: 'pg-dialog-foot' },
        h('input', {
          className: 'pg-dialog-new',
          type: 'text',
          placeholder: tr('catNamePlaceholder'),
          'aria-label': tr('catNew'),
          value: draft,
          onChange: (event) => { setDraft(event.target.value) },
          onKeyDown: (event) => { if (event.key === 'Enter') submitNew() },
        }),
        h('button', { type: 'button', className: 'pg-btn', 'data-pg-cat-add': '1', onClick: submitNew }, tr('catAdd')),
        h('button', { type: 'button', className: 'pg-btn', 'data-pg-cat-close': '1', onClick: onClose }, tr('catClose')))))
    }

    /**
     * 一个分区：可折叠的标题 + 计数 + 提示 + 行列表。
     * 有自定义分类时，行不再平铺，而是再套一层「分类文件夹」（二级目录）。
     */
    function Section({ section, rows, tr, resolveText, busyOf, lockedOf, onLock, onCats, catCountOf, onToggle, onOpen, collapsed, onCollapse, cats, catState, subCollapsed, onSubCollapse }) {
      const open = collapsed !== true
      // 标题两种来源：内置五区用 i18n 键，自定义分类用用户起的名字（label 直接给字符串）。
      const title = section.label === undefined ? tr(section.titleKey) : section.label
      // 自定义分类没有固定说明，hintKey 缺省时整行不渲染，避免留一条空段落。
      const hint = section.hintKey === undefined ? null : tr(section.hintKey)
      // 防抖：同一次点击若派发出两个事件（合成点击 + 原生 click），只认第一个，
      // 否则一次点击会翻两次状态、看起来像「点了没反应」。
      const lastAt = useRef(0)
      const toggle = () => {
        const now = Date.now()
        if (now - lastAt.current < 300) return
        lastAt.current = now
        onCollapse(section.id, open)
      }

      /** 行渲染：平铺与二级两条路径共用同一套接线，避免两边漂移。 */
      const rowOf = (bundle) => h(BundleRow, {
        key: bundle.name,
        bundle,
        tr,
        resolveText,
        busy: busyOf(bundle.name),
        locked: lockedOf(bundle.name),
        onLock,
        onCats,
        catCount: catCountOf(bundle.name),
        onToggle,
        onOpen,
      })

      /**
       * 二级分组：只有存在自定义分类时才拆，否则保持原来的平铺。
       * 一件插件归了多个分类就在多个文件夹里各出现一次（和 Steam 一个游戏挂多个分类一样）；
       * 一个都没归的进「未分类」，排在最后，没内容时不占位。
       *
       * 不可卸载的插件（dsh-base、Web 应用运行支持这类）**完全不进文件夹**：
       * 它们本来就不该被收藏，塞进「未分类」也只是把核心层伪装成一个空目录。
       * 这类行直接平铺在分区下面，走 plain 这一路。
       */
      const subs = useMemo(() => {
        if (cats === undefined || cats.length === 0) return null
        const byCat = new Map(cats.map(cat => [cat.id, []]))
        const none = []
        const plain = []
        for (const bundle of rows) {
          if (bundle.removable === false) { plain.push(bundle); continue }
          const list = (catState.map[bundle.name] || []).filter(id => byCat.has(id))
          if (list.length === 0) none.push(bundle)
          for (const id of list) byCat.get(id).push(bundle)
        }
        // 空分类只在「自装·在用」区露头（那是主要管理区，看得见结构才知道往里添东西）；
        // 核心层/闲置这些区里再挂一串空文件夹就是纯噪音。
        const entries = cats
          .map((cat, index) => ({
            id: cat.id,
            label: cat.name,
            color: colorOf(cat, index),
            rows: byCat.get(cat.id),
          }))
          .filter(entry => entry.rows.length > 0 || section.id === 'installed')
        if (none.length > 0) entries.push({ id: '__none', label: tr('catNone'), color: null, rows: none })
        return { entries, plain }
      }, [cats, catState, rows, tr])

      return h('section', { className: 'pg-group', 'data-pg-group': section.id, 'data-pg-open': open ? '1' : '0' },
        h('button', {
          type: 'button',
          className: 'pg-group-head',
          'aria-expanded': open ? 'true' : 'false',
          onClick: toggle,
        },
        h('svg', { className: 'pg-chev', 'data-open': open ? '1' : '0', width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none' },
          h('path', { d: 'M6 3.5L10.5 8L6 12.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' })),
        h('span', { className: 'pg-group-title' }, title),
        h('span', { className: 'pg-group-num' }, String(rows.length))),
        open && hint !== null ? h('p', { className: 'pg-group-hint' }, hint) : null,
        open
          ? subs === null
            // 没有自定义分类：维持平铺，不额外造一层空壳。
            ? h('ul', { className: 'pg-list' }, rows.map(rowOf))
            : h('div', { className: 'pg-subs' },
              // 先平铺不可卸载的行：它们不属于任何文件夹，直接挂在分区下面。
              subs.plain.length === 0 ? null : h('ul', { className: 'pg-list' }, subs.plain.map(rowOf)),
              subs.entries.map((group) => {
              const key = `${section.id}:${group.id}`
              const subOpen = subCollapsed(key) !== true
              return h('div', { className: 'pg-sub', key, 'data-pg-sub': key, 'data-pg-open': subOpen ? '1' : '0' },
                h('button', {
                  type: 'button',
                  className: 'pg-sub-head',
                  'aria-expanded': subOpen ? 'true' : 'false',
                  onClick: () => { onSubCollapse(key, subOpen) },
                },
                h('svg', { className: 'pg-sub-chev', 'data-open': subOpen ? '1' : '0', width: 10, height: 10, viewBox: '0 0 16 16', fill: 'none' },
                  h('path', { d: 'M6 3.5L10.5 8L6 12.5', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' })),
                // 色点：分类的身份证，和行内标签图标同色系，两侧能对上。
                group.color === null
                  ? h('span', { className: 'pg-dot', 'data-none': '1' })
                  : h('span', { className: 'pg-dot', style: { background: group.color } }),
                h('span', { className: 'pg-sub-name' }, group.label),
                h('span', { className: 'pg-sub-num' }, String(group.rows.length))),
                subOpen ? h('ul', { className: 'pg-list' }, group.rows.map(rowOf)) : null)
            }))
          : null)
    }

    /** 分类页签的主体。 */
    function GroupsTab(props) {
      const tr = props.tr
      const resolveText = props.resolveText
      // 清单、加载状态、错误
      const [bundles, setBundles] = useState([])
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState(null)
      // 单行进行中的开关
      const [busy, setBusy] = useState({})
      // 筛选词与折叠状态
      const [query, setQuery] = useState('')
      const [collapsed, setCollapsed] = useState({})
      // 刷新令牌：Host 变更事件 + 手动刷新 + 开关完成后都靠它触发重读
      const [tick, setTick] = useState(0)
      // 锁定清单（浏览器本地持久化）与「先解锁」提示
      const [locks, setLocks] = useState(readLocks)
      const [notice, setNotice] = useState(null)
      // 二级分组（自定义分类文件夹）的折叠状态，键是「分区id:分类id」
      const [subCollapsed, setSubCollapsed] = useState({})
      // 自定义分类数据与正在打开的对话框
      const [catState, setCatState] = useState(readCats)
      const [dialog, setDialog] = useState(null)

      useEffect(() => {
        let alive = true
        setStatus(current => (current === 'ready' ? 'refreshing' : 'loading'))
        props.list().then((rows) => {
          if (!alive) return
          const list = Array.isArray(rows) ? rows : []
          setBundles(list)
          // 本插件一旦在清单里（也就是它被启用），第一次就把自己锁上。
          ensureSelfLocked(list, setLocks)
          setError(null)
          setStatus('ready')
        }).catch((reason) => {
          if (!alive) return
          setError(String((reason && reason.message) || reason))
          setStatus('error')
        })
        return () => { alive = false }
      }, [tick])

      // Host 说清单变了（别处装了/删了/开关了）就重读；订阅本身由 apply 里的 effect 管生命周期。
      useEffect(() => props.subscribe(() => { setTick(value => value + 1) }), [])

      /** 这个包是否被锁。 */
      const lockedOf = (name) => locks.indexOf(name) !== -1

      /** 点锁图标：切换这一行的锁定，写回本地存储，并清掉上一次的提示。 */
      const onLock = (name) => {
        setLocks((current) => {
          const next = current.indexOf(name) === -1
            ? current.concat([name])
            : current.filter(item => item !== name)
          writeLocks(next)
          return next
        })
        setNotice(null)
      }

      /** 切换一件插件：锁只拦「关闭」；成功后重读，失败把原因留在页面上。 */
      const onToggle = (bundle, next) => {
        // 锁定的意义是防误关，所以开启一侧永远放行，不需要先解锁。
        if (next === false && lockedOf(bundle.name)) {
          setNotice({ name: bundle.name, text: tr('unlockFirst', { name: titleOf(bundle, resolveText) }) })
          return
        }
        setBusy(map => ({ ...map, [bundle.name]: true }))
        props.setEnabled(bundle.name, next).then(() => {
          setBusy((map) => { const copy = { ...map }; delete copy[bundle.name]; return copy })
          setTick(value => value + 1)
        }).catch((reason) => {
          setBusy((map) => { const copy = { ...map }; delete copy[bundle.name]; return copy })
          setError(String((reason && reason.message) || reason))
          setStatus('error')
        })
      }

      /** 打开内置详情页（会切到「已安装」页签，返回时回到本页签）。 */
      const onOpen = (name) => { props.openPackage(name) }

      /** 分类数据的唯一写入口：先落盘再更新 state，两步用同一份对象，避免界面与存储不同步。 */
      const writeCat = (next) => {
        writeCats(next)
        setCatState(next)
      }

      /** 勾选/取消一个分类：以数组为单位整体替换，空数组就把这个包从 map 里删掉，不留空壳。 */
      const onToggleCat = (pkg, catId) => {
        const list = catState.map[pkg] || []
        const nextList = list.includes(catId) ? list.filter(id => id !== catId) : list.concat([catId])
        const map = { ...catState.map }
        if (nextList.length === 0) delete map[pkg]
        else map[pkg] = nextList
        writeCat({ cats: catState.cats, map })
      }

      /**
       * 新建分类。若当前正在给某插件归类，顺手把新分类挂上去 ——
       * 建分类的意图十之八九就是「把当前这件归进去」，省一次点击。
       */
      const onCreateCat = (name) => {
        const id = nextCatId(catState.cats)
        // 颜色按已有分类数轮换，保证相邻新建的两个不同色。
        const cats = catState.cats.concat([{ id, name, color: catState.cats.length % CAT_COLORS.length }])
        let map = catState.map
        if (dialog !== null && dialog.mode === 'assign' && dialog.name != null) {
          map = { ...map, [dialog.name]: (map[dialog.name] || []).concat([id]) }
        }
        writeCat({ cats, map })
      }

      /** 改名：只动名字，不动归属。 */
      const onRenameCat = (id, name) => {
        writeCat({ cats: catState.cats.map(cat => (cat.id === id ? { id, name } : cat)), map: catState.map })
      }

      /** 删除分类：同时把各插件对它的引用清掉，删完不会留下指向空气的 id。 */
      const onRemoveCat = (id) => {
        const cats = catState.cats.filter(cat => cat.id !== id)
        const map = {}
        for (const [pkg, list] of Object.entries(catState.map)) {
          const kept = list.filter(item => item !== id)
          if (kept.length > 0) map[pkg] = kept
        }
        writeCat({ cats, map })
      }

      /** 这件插件归在几个自定义分类里（行内标签按钮的高亮依据）。 */
      const catCountOf = (name) => (catState.map[name] || []).length

      const groups = useMemo(() => {
        const buckets = new Map(SECTIONS.map(section => [section.id, []]))
        for (const bundle of bundles) {
          const id = classify(bundle)
          if (id === null) continue
          buckets.get(id).push(bundle)
        }
        // 每个分区内按显示标题排序，读起来稳定。
        for (const rows of buckets.values()) {
          rows.sort((a, b) => titleOf(a, resolveText).localeCompare(titleOf(b, resolveText), 'zh-Hans-CN'))
        }
        return buckets
      }, [bundles, resolveText])

      // 筛选：标题与包名都能命中。
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const result = new Map()
        for (const [id, rows] of groups.entries()) {
          result.set(id, needle === ''
            ? rows
            : rows.filter(bundle => titleOf(bundle, resolveText).toLowerCase().includes(needle)
              || bundle.name.toLowerCase().includes(needle)))
        }
        return result
      }, [groups, query, resolveText])

      const totals = useMemo(() => ({
        total: [...filtered.values()].reduce((sum, rows) => sum + rows.length, 0),
        core: (filtered.get('core') || []).length,
        installed: (filtered.get('installed') || []).length,
        idle: (filtered.get('idle') || []).length,
      }), [filtered])

      /**
       * 每个分类里实际有几件插件（对话框右侧的数字）。
       * 口径必须和二级文件夹一致：不可卸载的插件不计入，否则对话框写「必留 3」而文件夹里只有 2 件。
       */
      const catCounts = useMemo(() => {
        const counts = {}
        for (const cat of catState.cats) counts[cat.id] = 0
        for (const bundle of bundles) {
          if (bundle.removable === false) continue
          for (const id of catState.map[bundle.name] || []) {
            if (counts[id] !== undefined) counts[id] += 1
          }
        }
        return counts
      }, [catState, bundles])

      /**
       * 按自定义分类分组，产出与必要性视图同形的 [{ section, rows }]。
       *
       * 三个刻意的选择：
       * 1. 一件插件可以同时出现在多个分类里，所以这里**不去重**，逐个分类各放一份；
       * 2. 一个分类都没归的进「未分类」，固定排在最后，随时能看到还剩多少没整理；
       * 3. 搜索时把空分类隐掉（否则满屏 0），不搜索时保留空分类（方便往里添东西）。
       */
      const busyOf = (name) => busy[name] === true
      // 只有必要性五区；自定义分类作为二级文件夹嵌在各区内部（Section 里处理）。
      const shown = status === 'loading'
        ? null
        : SECTIONS
          .map(section => ({ section, rows: filtered.get(section.id) || [] }))
          .filter(entry => entry.rows.length > 0)

      return h('section', { className: 'pg-page', 'data-pg-page': 'groups' },
        h('style', null, CSS),
        h('header', { className: 'pg-head' },
          h('h2', { className: 'pg-title' }, tr('title')),
          h('p', { className: 'pg-intro' }, tr('intro'))),
        h('div', { className: 'pg-toolbar' },
          h('input', {
            className: 'pg-search',
            type: 'search',
            placeholder: tr('searchPlaceholder'),
            'aria-label': tr('searchPlaceholder'),
            value: query,
            onChange: (event) => { setQuery(event.target.value) },
          }),
          h('button', {
            type: 'button',
            className: 'pg-btn',
            disabled: status === 'loading' || status === 'refreshing',
            onClick: () => { setTick(value => value + 1) },
          }, status === 'refreshing' ? tr('working') : tr('refresh')),
          // 「管理分类」常驻：分类现在是嵌在分区里的二级结构，入口不该藏在某个视图里。
          h('button', {
            type: 'button',
            className: 'pg-btn',
            'data-pg-cat-manage': '1',
            onClick: () => { setDialog({ mode: 'manage', name: null }) },
          }, tr('catManage')),
          h('span', { className: 'pg-count' }, tr('summary', {
            total: String(totals.total),
            core: String(totals.core),
            installed: String(totals.installed),
            idle: String(totals.idle),
          }))),
        notice === null ? null : h('p', { className: 'pg-notice', role: 'alert', 'data-pg-notice': notice.name },
          h('span', { className: 'pg-notice-text' }, notice.text),
          h('button', {
            type: 'button',
            className: 'pg-notice-x',
            'aria-label': tr('detail'),
            onClick: () => { setNotice(null) },
          }, '×')),
        error === null ? null : h('p', { className: 'pg-error' }, tr('loadFailed', { error })),
        // 一个分类都没建时给一句引导；建过之后就靠每行右侧的标签图标归类。
        catState.cats.length === 0 && status === 'ready' && bundles.length > 0
          ? h('p', { className: 'pg-empty' }, tr('catEmpty'))
          : null,
        shown === null
          ? null
          : shown.length === 0
            // 读失败时只留错误行，不再叠一句「没有可分类的插件」误导人。
            ? error === null
              ? h('p', { className: 'pg-empty' }, bundles.length === 0 ? tr('empty') : tr('filterEmpty'))
              : null
            : shown.map(entry => h(Section, {
              key: entry.section.id,
              section: entry.section,
              rows: entry.rows,
              tr,
              resolveText,
              busyOf,
              lockedOf,
              onLock,
              // 行内标签按钮：打开「设置分类」，只对会出现在分类页的插件有意义。
              onCats: (bundle) => { setDialog({ mode: 'assign', name: bundle.name }) },
              catCountOf,
              onToggle,
              onOpen,
              collapsed: collapsed[entry.section.id] === true,
              onCollapse: (id, open) => { setCollapsed(map => ({ ...map, [id]: open })) },
              // 二级文件夹：分类清单 + 归属表 + 各自的折叠状态。
              cats: catState.cats,
              catState,
              subCollapsed: (key) => subCollapsed[key] === true,
              onSubCollapse: (key, open) => { setSubCollapsed(map => ({ ...map, [key]: open })) },
            })),
        // 对话框挂在最后：它自己用 fixed 遮罩覆盖整页，不影响上面的布局。
        dialog === null ? null : h(CatDialog, {
          tr,
          mode: dialog.mode,
          bundle: dialog.name === null ? null : (bundles.find(item => item.name === dialog.name) || null),
          bundleTitle: dialog.name === null ? '' : (() => {
            const found = bundles.find(item => item.name === dialog.name)
            return found === undefined ? dialog.name : titleOf(found, resolveText)
          })(),
          state: catState,
          counts: catCounts,
          onToggle: onToggleCat,
          onCreate: onCreateCat,
          onRename: onRenameCat,
          onRemove: onRemoveCat,
          onClose: () => { setDialog(null) },
        }))
    }

    return {
      // 只声明真正用到的服务；没有它们时本插件不激活，不会把页面打空。
      inject: ['slots', 'locale', 'remote', 'remote.pluginManager'],
      apply(ctx) {
        // 字典注册在 effect 里，插件卸载时自动摘掉。
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plugin-groups: dictionaries')
        const tr = ctx.locale.bind(NS)
        const resolveText = (text) => ctx.locale.resolveText(text)

        // Host 侧的变更通知（安装、卸载、开关、重启）都汇到一个监听表里，交给挂载中的组件。
        const listeners = new Set()
        ctx.effect(() => {
          const off = ctx.remote.$on('plugin-manager/changed', () => {
            for (const listener of [...listeners]) {
              try { listener() } catch (reason) { console.error('plugin-groups listener crashed', reason) }
            }
          })
          return () => { off(); listeners.clear() }
        }, 'plugin-groups: host invalidations')

        // 交给页签的接口：读清单、写开关、订阅变更、翻译、本地化文本。
        const face = {
          tr,
          resolveText,
          // 读清单：拆信封后把 BundleInfo 数组交给组件。
          list: () => ctx.remote.pluginManager.listBundles()
            .then(result => unwrap(result, 'pluginManager/listBundles')),
          // 写开关：同样是信封，另外把「应用失败」也算成错误，界面才不会假装成功。
          setEnabled: (name, enabled) => ctx.remote.pluginManager.setBundleEnabled(name, enabled)
            .then((result) => {
              const value = unwrap(result, 'pluginManager/setBundleEnabled')
              if (value !== null && typeof value === 'object' && value.application === 'failed') {
                const detail = value.error && (value.error.message || value.error.code)
                throw new Error(detail === undefined ? 'application failed' : String(detail))
              }
              return value
            }),
          subscribe: (listener) => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
          },
        }

        // 注册到页签列表；owner 声明崩溃/折叠时会连带卸载本项。
        ctx.slots.inject('plugins.tab', () => ctx.slots.register({
          name: 'plugins.tab',
          id: 'plugin-groups',
          label: () => tr('tabLabel'),
          order: 5,
          locale: NS,
          inject: () => face,
        }, GroupsTab))
      },
    }
  },
})
