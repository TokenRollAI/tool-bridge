/**
 * Dropbox —— 从 open-connector 迁移的 provider(24 个 action:账户、文件与文件夹、搜索、
 * 版本、标签、共享链接)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * ## 这是本仓库的 **OAuth2 provider** 形态
 *
 * 端点与 scope 抄自上游 `definition.ts` 的 `auth[0]`。三点值得说明:
 *
 * - `token_access_type: 'offline'` **必须带**。Dropbox 只在这个模式下返回 refresh_token;
 *   缺了它 access token 一过期(默认 4 小时)就得让用户手工重新授权一次,而平台侧无从
 *   自动续期。这是整段声明里最容易漏、且漏了要到几小时后才暴露的一项。
 * - `clientAuth: 'client_secret_post'` 与上游 `tokenEndpointAuthMethod` 一致(也正好是
 *   SDK 缺省值,写出来是为了让"上游声明过这一项"这件事在代码里可见)。
 * - scope 是上游 `scopes.ts` 的全量 6 项:账户读 + 文件元数据读 + 文件内容读写 +
 *   共享读写。少一项就有 action 在运行期报 `missing_scope`,而那要等真正调用才发现。
 *
 * 声明了 `oauth` 的 export **不能**再声明 `credentialProbe` 或 `credentialFields`
 * (SDK 装配期就拒)—— 故本 provider 没有探针,`get_current_account` 只是普通 action。
 * client_id/secret 不在这里:它们是每个部署自己去 Dropbox 后台注册的,走 authRef 指向的 secret。
 */

import {
  copy,
  createFolder,
  createSharedLink,
  deletePath,
  downloadFile,
  getCurrentAccount,
  getMetadata,
  getSharedLinkFile,
  getSharedLinkMetadata,
  getTags,
  getTemporaryLink,
  listFolder,
  listFolderContinue,
  listRevisions,
  listSharedLinks,
  modifySharedLink,
  move,
  restore,
  revokeSharedLink,
  saveUrl,
  saveUrlCheckJobStatus,
  searchFiles,
  searchFilesContinue,
  uploadFile,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { dropboxActions } from './schema'

export type { ProviderEnv as Env }

export function createDropboxPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Dropbox',
    actions: dropboxActions,
    oauth: {
      authorizationUrl: 'https://www.dropbox.com/oauth2/authorize',
      tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
      scopes: [
        'account_info.read',
        'files.metadata.read',
        'files.content.read',
        'files.content.write',
        'sharing.read',
        'sharing.write',
      ],
      clientAuth: 'client_secret_post',
      // 没有它 Dropbox 不发 refresh_token(见文件头)。
      authorizationParams: { token_access_type: 'offline' },
    },
    handlers: {
      get_current_account: getCurrentAccount,
      list_folder: listFolder,
      list_folder_continue: listFolderContinue,
      get_metadata: getMetadata,
      download_file: downloadFile,
      upload_file: uploadFile,
      create_folder: createFolder,
      move,
      copy,
      delete: deletePath,
      create_shared_link: createSharedLink,
      list_shared_links: listSharedLinks,
      search_files: searchFiles,
      search_files_continue: searchFilesContinue,
      get_temporary_link: getTemporaryLink,
      save_url: saveUrl,
      save_url_check_job_status: saveUrlCheckJobStatus,
      list_revisions: listRevisions,
      restore,
      get_shared_link_metadata: getSharedLinkMetadata,
      get_shared_link_file: getSharedLinkFile,
      modify_shared_link: modifySharedLink,
      revoke_shared_link: revokeSharedLink,
      get_tags: getTags,
    },
  })
}

export default createDropboxPlugin()
