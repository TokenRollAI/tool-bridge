/**
 * Trello —— 从 open-connector 迁移的 provider(28 个看板/列表/卡片/清单 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 *
 * 凭证是**两个字段**(API Key + API Token),对应上游 `custom_credential` 的 `auth[0].fields`;
 * 字段名必须与上游一致,否则已有的凭证记录挂过来取不到值。
 * 两个值最终都进出站 URL 的 query(Trello 的 API 设计),细节见 `api.ts` 顶部注释。
 *
 * credentialProbe 选 `get_member`:read、无必填入参(memberId 缺省 `me`),正是上游
 * `definition.ts` 里 `testAction` 指定的那一个。
 */

import {
  addCardAttachmentUrl,
  addCardComment,
  addCardLabel,
  addCardMember,
  addCheckitem,
  archiveCard,
  archiveList,
  createBoard,
  createCard,
  createChecklist,
  createList,
  getBoard,
  getCard,
  getMember,
  listBoardCards,
  listBoardLabels,
  listBoardLists,
  listBoardMembers,
  listCardChecklists,
  listCardComments,
  listMemberBoards,
  moveCard,
  removeCardLabel,
  removeCardMember,
  search,
  updateCard,
  updateCheckitemState,
  updateList,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { trelloActions } from './schema'

export type { ProviderEnv as Env }

export function createTrelloPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'Trello',
    actions: trelloActions,
    credentialFields: [
      {
        key: 'apiKey',
        label: 'API Key',
        required: true,
        secret: true,
        description: 'https://trello.com/power-ups/admin 上 Key 一栏的值'
          + '(不是 API Secret,也不是 Atlassian API token)',
      },
      {
        key: 'apiToken',
        label: 'API Token',
        required: true,
        secret: true,
        description: '在同一页面 API Key 旁边的 Token 链接里生成(与 API Secret 不是一回事)',
      },
    ],
    credentialProbe: 'get_member',
    handlers: {
      get_member: getMember,
      list_member_boards: listMemberBoards,
      get_board: getBoard,
      create_board: createBoard,
      list_board_lists: listBoardLists,
      create_list: createList,
      update_list: updateList,
      archive_list: archiveList,
      list_board_cards: listBoardCards,
      list_board_members: listBoardMembers,
      list_board_labels: listBoardLabels,
      get_card: getCard,
      create_card: createCard,
      move_card: moveCard,
      archive_card: archiveCard,
      update_card: updateCard,
      add_card_comment: addCardComment,
      list_card_comments: listCardComments,
      add_card_member: addCardMember,
      remove_card_member: removeCardMember,
      add_card_label: addCardLabel,
      remove_card_label: removeCardLabel,
      create_checklist: createChecklist,
      list_card_checklists: listCardChecklists,
      add_checkitem: addCheckitem,
      update_checkitem_state: updateCheckitemState,
      add_card_attachment_url: addCardAttachmentUrl,
      search,
    },
  })
}

export default createTrelloPlugin()
