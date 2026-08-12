/**
 * SendFox —— 从 open-connector 迁移的 provider(api_key,14 个 action)。
 *
 * 分工同其他迁移产物:`schema.ts` 是生成的 Zod 声明,`api.ts` 是人工改写的业务逻辑,
 * 本文件把两张表对起来(键集合不吻合会在装配期炸)。
 */

import {
  addContactToList,
  createContact,
  createContactList,
  deleteContact,
  deleteContactList,
  getContact,
  getContactList,
  listContactLists,
  listContacts,
  listContactsInList,
  removeContactFromList,
  unsubscribeContact,
  updateContact,
  updateContactList,
} from './api'
import { createProviderPlugin, type ProviderEnv } from '../_runtime/plugin'
import { sendfoxActions } from './schema'

export type { ProviderEnv as Env }

export function createSendfoxPlugin(): ReturnType<typeof createProviderPlugin> {
  return createProviderPlugin({
    description: 'SendFox',
    actions: sendfoxActions,
    // 上游 credentialValidators 打的是 /me,但那个端点没有对应的 action。
    // list_contact_lists 只读、无必填入参,是最便宜的替代。
    credentialProbe: 'list_contact_lists',
    handlers: {
      list_contacts: listContacts,
      create_contact: createContact,
      get_contact: getContact,
      update_contact: updateContact,
      delete_contact: deleteContact,
      unsubscribe_contact: unsubscribeContact,
      list_contact_lists: listContactLists,
      create_contact_list: createContactList,
      get_contact_list: getContactList,
      update_contact_list: updateContactList,
      delete_contact_list: deleteContactList,
      list_contacts_in_list: listContactsInList,
      add_contact_to_list: addContactToList,
      remove_contact_from_list: removeContactFromList,
    },
  })
}

export default createSendfoxPlugin()
