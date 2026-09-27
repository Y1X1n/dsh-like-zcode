/**
 * 测试聚合出口(打包为 lib/core.js 供 node:test 直接引用;纯逻辑,不碰 dsh 宿主)。
 */
export * from './ignore.js'
export * from './scanner.js'
export * from './throttle.js'
export * from './crypto.js'
export * from './manifest.js'
export * from './engine.js'
export { createBackend, testBackendConfig } from '../backends/index.js'
export { LocalDirBackend } from '../backends/localdir.js'
export { WebDavBackend } from '../backends/webdav.js'
export { S3Backend, encodeKey, canonicalQuery } from '../backends/s3.js'
export { resolveConfig, normalizeBackend, normalizeScheduleMode, parseWorkspaces, ConfigSchema, NS } from '../config.js'
export type { LikeZcodeConfig, BackendKind, ScheduleMode } from '../config.js'
