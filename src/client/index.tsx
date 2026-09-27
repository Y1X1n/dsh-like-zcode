import type { Context as ClientContext } from '@deepseek-ai/cordis'
// 类型级引入,激活槽位与设置面的 Context 合并声明:
//   slots 由 ui-renderer 声明,settingsScope 由 ui-settings 声明,
//   settings.plugin.item 槽位的 SlotMap 由 settings-plugins 声明。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { createSettingsCard } from './SettingsCard.js'
import { createStatusController } from './controller.js'

export const name = 'dsh-like-zcode-client'
// settingsScope 的绑定内部依赖 connection(读写传输)与 remote(失效通知)。
export const inject = ['slots', 'connection', 'remote', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const controller = createStatusController()
  const scope = ctx.settingsScope.bind<import('./SettingsCard.js').LikeZcodeSettingsValue>({ namespace: 'like-zcode' })

  // 有意为之:这里不注入任何会话槽位(conversation.*)——
  // "会话内零通知"是结构性保证,不是靠自觉。唯一的 UI 出口是插件设置卡片
  // (设置 → 插件 → Like ZCode;非 session scope,声明式挂载)。
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({ name: 'settings.plugin.item', key: 'like-zcode' }, createSettingsCard(scope, controller)),
  )
}
