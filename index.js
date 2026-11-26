/**
 * Host 半边：本插件不需要任何 Host 能力。
 * 界面完全由 client.js 通过 `plugins.tab` 插槽贡献，这里保留一个空的 apply，
 * 只是为了让 bundle 在 Loader 里有一行可管理的入口（可开关、可卸载）。
 *
 * 注意：`name` 必须与 cordis.patch.yml 里 insert.id 一致，
 * Loader 靠它对上号，否则会当成两个插件。
 */
export const name = 'plugin-groups'

/** 不注入任何 Host 服务：本插件只做浏览器侧渲染。 */
export const inject = []

/** 空实现：不做任何 Host 侧挂载。 */
export function apply() {}
