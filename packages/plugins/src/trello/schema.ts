/**
 * Trello 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getMemberInput = z.strictObject({
  memberId: z.string().min(1).describe('Trello member ID or the me shortcut. Defaults to me.').optional(),
  fields: z.array(z.string().min(1).describe('One Trello field name to include in the response.')).min(1).describe('Comma-joined Trello fields to request from the REST API.').optional(),
}).describe('Input parameters for retrieving a Trello member.')

export const getMemberOutput = z.strictObject({
  member: z.looseObject({
    id: z.string().describe('Trello member ID.').optional(),
    username: z.string().describe('Trello username.').optional(),
    fullName: z.string().describe('Display name for the Trello member.').optional(),
  }).describe('A normalized Trello member returned by the REST API.').optional(),
}).describe('The retrieved Trello member.')

export const listMemberBoardsInput = z.strictObject({
  memberId: z.string().min(1).describe('Trello member ID or the me shortcut. Defaults to me.').optional(),
  fields: z.array(z.string().min(1).describe('One Trello field name to include in the response.')).min(1).describe('Comma-joined Trello fields to request from the REST API.').optional(),
  filter: z.enum(['all', 'closed', 'members', 'open', 'organization', 'public', 'starred']).describe('Board filter passed to Trello.').optional(),
}).describe('Input parameters for listing boards for a Trello member.')

export const listMemberBoardsOutput = z.strictObject({
  boards: z.array(z.looseObject({
    id: z.string().describe('Trello board ID.').optional(),
    name: z.string().describe('Board name.').optional(),
    description: z.string().describe('Board description.').optional(),
    url: z.url().describe('Public Trello board URL.').optional(),
    shortUrl: z.url().describe('Short Trello board URL.').optional(),
    closed: z.boolean().describe('Whether the board is closed.').optional(),
  }).describe('A normalized Trello board returned by the REST API.')).describe('Trello boards.').optional(),
}).describe('Boards returned by Trello.')

export const getBoardInput = z.strictObject({
  boardId: z.string().min(1).describe('Trello board ID.'),
  fields: z.array(z.string().min(1).describe('One Trello field name to include in the response.')).min(1).describe('Comma-joined Trello fields to request from the REST API.').optional(),
}).describe('Input parameters for retrieving a Trello board.')

export const getBoardOutput = z.strictObject({
  board: z.looseObject({
    id: z.string().describe('Trello board ID.').optional(),
    name: z.string().describe('Board name.').optional(),
    description: z.string().describe('Board description.').optional(),
    url: z.url().describe('Public Trello board URL.').optional(),
    shortUrl: z.url().describe('Short Trello board URL.').optional(),
    closed: z.boolean().describe('Whether the board is closed.').optional(),
  }).describe('A normalized Trello board returned by the REST API.').optional(),
}).describe('The retrieved Trello board.')

export const createBoardInput = z.strictObject({
  name: z.string().min(1).describe('Board name.'),
  description: z.string().describe('Board description.').optional(),
  defaultLists: z.boolean().describe('Whether Trello should create default lists on the board.').optional(),
  permissionLevel: z.enum(['org', 'private', 'public']).describe('Board visibility preference.').optional(),
}).describe('Input parameters for creating a Trello board.')

export const createBoardOutput = z.strictObject({
  board: z.looseObject({
    id: z.string().describe('Trello board ID.').optional(),
    name: z.string().describe('Board name.').optional(),
    description: z.string().describe('Board description.').optional(),
    url: z.url().describe('Public Trello board URL.').optional(),
    shortUrl: z.url().describe('Short Trello board URL.').optional(),
    closed: z.boolean().describe('Whether the board is closed.').optional(),
  }).describe('A normalized Trello board returned by the REST API.').optional(),
}).describe('The created Trello board.')

export const listBoardListsInput = z.strictObject({
  boardId: z.string().min(1).describe('Trello board ID.'),
  filter: z.enum(['all', 'closed', 'none', 'open']).describe('List filter passed to Trello.').optional(),
}).describe('Input parameters for listing Trello lists on a board.')

export const listBoardListsOutput = z.strictObject({
  lists: z.array(z.looseObject({
    id: z.string().describe('Trello list ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the list.').optional(),
    name: z.string().describe('List name.').optional(),
    closed: z.boolean().describe('Whether the list is closed.').optional(),
    position: z.number().describe('List position on the board.').optional(),
  }).describe('A normalized Trello list returned by the REST API.')).describe('Trello lists.').optional(),
}).describe('Lists returned by Trello.')

export const createListInput = z.strictObject({
  boardId: z.string().min(1).describe('Trello board ID that will own the list.'),
  name: z.string().min(1).describe('List name.'),
  position: z.union([z.enum(['top', 'bottom']).describe('Named list position.'), z.number().describe('Numeric list position.')]).describe('List position. Use top, bottom, or a numeric position.').optional(),
}).describe('Input parameters for creating a Trello list.')

export const createListOutput = z.strictObject({
  list: z.looseObject({
    id: z.string().describe('Trello list ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the list.').optional(),
    name: z.string().describe('List name.').optional(),
    closed: z.boolean().describe('Whether the list is closed.').optional(),
    position: z.number().describe('List position on the board.').optional(),
  }).describe('A normalized Trello list returned by the REST API.').optional(),
}).describe('The created Trello list.')

export const updateListInput = z.strictObject({
  listId: z.string().min(1).describe('Trello list ID.'),
  name: z.string().min(1).describe('List name.').optional(),
  position: z.union([z.enum(['top', 'bottom']).describe('Named list position.'), z.number().describe('Numeric list position.')]).describe('List position. Use top, bottom, or a numeric position.').optional(),
}).describe('Input parameters for updating a Trello list.')

export const updateListOutput = z.strictObject({
  list: z.looseObject({
    id: z.string().describe('Trello list ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the list.').optional(),
    name: z.string().describe('List name.').optional(),
    closed: z.boolean().describe('Whether the list is closed.').optional(),
    position: z.number().describe('List position on the board.').optional(),
  }).describe('A normalized Trello list returned by the REST API.').optional(),
}).describe('The updated Trello list.')

export const archiveListInput = z.strictObject({
  listId: z.string().min(1).describe('Trello list ID.').optional(),
}).describe('Input parameters for archiving a Trello list.')

export const archiveListOutput = z.strictObject({
  list: z.looseObject({
    id: z.string().describe('Trello list ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the list.').optional(),
    name: z.string().describe('List name.').optional(),
    closed: z.boolean().describe('Whether the list is closed.').optional(),
    position: z.number().describe('List position on the board.').optional(),
  }).describe('A normalized Trello list returned by the REST API.').optional(),
}).describe('The archived Trello list.')

export const listBoardCardsInput = z.strictObject({
  boardId: z.string().min(1).describe('Trello board ID.'),
  filter: z.enum(['all', 'closed', 'none', 'open', 'visible']).describe('Card filter passed to Trello.').optional(),
  fields: z.array(z.string().min(1).describe('One Trello field name to include in the response.')).min(1).describe('Comma-joined Trello fields to request from the REST API.').optional(),
}).describe('Input parameters for listing Trello cards on a board.')

export const listBoardCardsOutput = z.strictObject({
  cards: z.array(z.looseObject({
    id: z.string().describe('Trello card ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the card.').optional(),
    listId: z.string().describe('Trello list ID that contains the card.').optional(),
    name: z.string().describe('Card name.').optional(),
    description: z.string().describe('Card description.').optional(),
    url: z.url().describe('Public Trello card URL.').optional(),
    shortUrl: z.url().describe('Short Trello card URL.').optional(),
    closed: z.boolean().describe('Whether the card is closed.').optional(),
    due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
    dueComplete: z.boolean().describe('Whether the card due date is marked complete.').optional(),
  }).describe('A normalized Trello card returned by the REST API.')).describe('Trello cards.').optional(),
}).describe('Cards returned by Trello.')

export const listBoardMembersInput = z.strictObject({
  boardId: z.string().min(1).describe('Trello board ID.'),
  fields: z.array(z.string().min(1).describe('One Trello field name to include in the response.')).min(1).describe('Comma-joined Trello fields to request from the REST API.').optional(),
}).describe('Input parameters for listing Trello board members.')

export const listBoardMembersOutput = z.strictObject({
  members: z.array(z.looseObject({
    id: z.string().describe('Trello member ID.').optional(),
    username: z.string().describe('Trello username.').optional(),
    fullName: z.string().describe('Display name for the Trello member.').optional(),
  }).describe('A normalized Trello member returned by the REST API.')).describe('Trello members.').optional(),
}).describe('Board members returned by Trello.')

export const listBoardLabelsInput = z.strictObject({
  boardId: z.string().min(1).describe('Trello board ID.').optional(),
}).describe('Input parameters for listing Trello board labels.')

export const listBoardLabelsOutput = z.strictObject({
  labels: z.array(z.looseObject({}).describe('A Trello label returned by the API.')).describe('Trello labels.').optional(),
}).describe('Board labels returned by Trello.')

export const getCardInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.'),
  fields: z.array(z.string().min(1).describe('One Trello field name to include in the response.')).min(1).describe('Comma-joined Trello fields to request from the REST API.').optional(),
}).describe('Input parameters for retrieving a Trello card.')

export const getCardOutput = z.strictObject({
  card: z.looseObject({
    id: z.string().describe('Trello card ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the card.').optional(),
    listId: z.string().describe('Trello list ID that contains the card.').optional(),
    name: z.string().describe('Card name.').optional(),
    description: z.string().describe('Card description.').optional(),
    url: z.url().describe('Public Trello card URL.').optional(),
    shortUrl: z.url().describe('Short Trello card URL.').optional(),
    closed: z.boolean().describe('Whether the card is closed.').optional(),
    due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
    dueComplete: z.boolean().describe('Whether the card due date is marked complete.').optional(),
  }).describe('A normalized Trello card returned by the REST API.').optional(),
}).describe('The retrieved Trello card.')

export const createCardInput = z.strictObject({
  listId: z.string().min(1).describe('Trello list ID that will contain the new card.'),
  name: z.string().min(1).describe('Card name.'),
  description: z.string().describe('Card description.').optional(),
  due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
  position: z.union([z.enum(['top', 'bottom']).describe('Named card position.'), z.number().describe('Numeric card position.')]).describe('Card position. Use top, bottom, or a numeric position.').optional(),
  memberIds: z.array(z.string().min(1).describe('One Trello member ID.')).min(1).describe('Trello member IDs to assign to the card.').optional(),
  labelIds: z.array(z.string().min(1).describe('One Trello label ID.')).min(1).describe('Trello label IDs to assign to the card.').optional(),
}).describe('Input parameters for creating a Trello card.')

export const createCardOutput = z.strictObject({
  card: z.looseObject({
    id: z.string().describe('Trello card ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the card.').optional(),
    listId: z.string().describe('Trello list ID that contains the card.').optional(),
    name: z.string().describe('Card name.').optional(),
    description: z.string().describe('Card description.').optional(),
    url: z.url().describe('Public Trello card URL.').optional(),
    shortUrl: z.url().describe('Short Trello card URL.').optional(),
    closed: z.boolean().describe('Whether the card is closed.').optional(),
    due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
    dueComplete: z.boolean().describe('Whether the card due date is marked complete.').optional(),
  }).describe('A normalized Trello card returned by the REST API.').optional(),
}).describe('The created Trello card.')

export const moveCardInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.'),
  listId: z.string().min(1).describe('Destination Trello list ID.'),
  position: z.union([z.enum(['top', 'bottom']).describe('Named card position.'), z.number().describe('Numeric card position.')]).describe('Card position. Use top, bottom, or a numeric position.').optional(),
}).describe('Input parameters for moving a Trello card.')

export const moveCardOutput = z.strictObject({
  card: z.looseObject({
    id: z.string().describe('Trello card ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the card.').optional(),
    listId: z.string().describe('Trello list ID that contains the card.').optional(),
    name: z.string().describe('Card name.').optional(),
    description: z.string().describe('Card description.').optional(),
    url: z.url().describe('Public Trello card URL.').optional(),
    shortUrl: z.url().describe('Short Trello card URL.').optional(),
    closed: z.boolean().describe('Whether the card is closed.').optional(),
    due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
    dueComplete: z.boolean().describe('Whether the card due date is marked complete.').optional(),
  }).describe('A normalized Trello card returned by the REST API.').optional(),
}).describe('The moved Trello card.')

export const archiveCardInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
}).describe('Input parameters for archiving a Trello card.')

export const archiveCardOutput = z.strictObject({
  card: z.looseObject({
    id: z.string().describe('Trello card ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the card.').optional(),
    listId: z.string().describe('Trello list ID that contains the card.').optional(),
    name: z.string().describe('Card name.').optional(),
    description: z.string().describe('Card description.').optional(),
    url: z.url().describe('Public Trello card URL.').optional(),
    shortUrl: z.url().describe('Short Trello card URL.').optional(),
    closed: z.boolean().describe('Whether the card is closed.').optional(),
    due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
    dueComplete: z.boolean().describe('Whether the card due date is marked complete.').optional(),
  }).describe('A normalized Trello card returned by the REST API.').optional(),
}).describe('The archived Trello card.')

export const updateCardInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.'),
  name: z.string().min(1).describe('Card name.').optional(),
  description: z.string().describe('Card description.').optional(),
  due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
  position: z.union([z.enum(['top', 'bottom']).describe('Named card position.'), z.number().describe('Numeric card position.')]).describe('Card position. Use top, bottom, or a numeric position.').optional(),
  memberIds: z.array(z.string().min(1).describe('One Trello member ID.')).min(1).describe('Trello member IDs to assign to the card.').optional(),
  labelIds: z.array(z.string().min(1).describe('One Trello label ID.')).min(1).describe('Trello label IDs to assign to the card.').optional(),
  listId: z.string().min(1).describe('Trello list ID to move the card into.').optional(),
  closed: z.boolean().describe('Whether the card should be closed.').optional(),
  dueComplete: z.boolean().describe('Whether the card due date should be marked complete.').optional(),
}).describe('Input parameters for updating a Trello card.')

export const updateCardOutput = z.strictObject({
  card: z.looseObject({
    id: z.string().describe('Trello card ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the card.').optional(),
    listId: z.string().describe('Trello list ID that contains the card.').optional(),
    name: z.string().describe('Card name.').optional(),
    description: z.string().describe('Card description.').optional(),
    url: z.url().describe('Public Trello card URL.').optional(),
    shortUrl: z.url().describe('Short Trello card URL.').optional(),
    closed: z.boolean().describe('Whether the card is closed.').optional(),
    due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
    dueComplete: z.boolean().describe('Whether the card due date is marked complete.').optional(),
  }).describe('A normalized Trello card returned by the REST API.').optional(),
}).describe('The updated Trello card.')

export const addCardCommentInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
  text: z.string().min(1).describe('Comment text to add to the card.').optional(),
}).describe('Input parameters for adding a Trello card comment.')

export const addCardCommentOutput = z.strictObject({
  action: z.looseObject({
    id: z.string().describe('Trello action ID.').optional(),
    type: z.string().describe('Trello action type.').optional(),
    data: z.looseObject({}).describe('Action data returned by Trello.').optional(),
    date: z.iso.datetime({ offset: true }).describe('Action creation timestamp in ISO 8601 format.').optional(),
  }).describe('A Trello action returned by the REST API.').optional(),
}).describe('The created Trello comment action.')

export const listCardCommentsInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.'),
  limit: z.int().min(1).max(1000).describe('Maximum number of comment actions to return.').optional(),
}).describe('Input parameters for listing Trello card comments.')

export const listCardCommentsOutput = z.strictObject({
  comments: z.array(z.looseObject({
    id: z.string().describe('Trello action ID.').optional(),
    type: z.string().describe('Trello action type.').optional(),
    data: z.looseObject({}).describe('Action data returned by Trello.').optional(),
    date: z.iso.datetime({ offset: true }).describe('Action creation timestamp in ISO 8601 format.').optional(),
  }).describe('A Trello action returned by the REST API.')).describe('Trello comment actions.').optional(),
}).describe('Comment actions returned by Trello.')

export const addCardMemberInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
  memberId: z.string().min(1).describe('Trello member ID to assign.').optional(),
}).describe('Input parameters for assigning a Trello member to a card.')

export const addCardMemberOutput = z.strictObject({
  success: z.boolean().describe('Whether Trello accepted the mutation.').optional(),
}).describe('A successful Trello mutation response.')

export const removeCardMemberInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
  memberId: z.string().min(1).describe('Trello member ID to remove.').optional(),
}).describe('Input parameters for removing a Trello member from a card.')

export const removeCardMemberOutput = z.strictObject({
  success: z.boolean().describe('Whether Trello accepted the mutation.').optional(),
}).describe('A successful Trello mutation response.')

export const addCardLabelInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
  labelId: z.string().min(1).describe('Trello label ID to add.').optional(),
}).describe('Input parameters for adding a Trello label to a card.')

export const addCardLabelOutput = z.strictObject({
  success: z.boolean().describe('Whether Trello accepted the mutation.').optional(),
}).describe('A successful Trello mutation response.')

export const removeCardLabelInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
  labelId: z.string().min(1).describe('Trello label ID to remove.').optional(),
}).describe('Input parameters for removing a Trello label from a card.')

export const removeCardLabelOutput = z.strictObject({
  success: z.boolean().describe('Whether Trello accepted the mutation.').optional(),
}).describe('A successful Trello mutation response.')

export const createChecklistInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
  name: z.string().min(1).describe('Checklist name.').optional(),
}).describe('Input parameters for creating a Trello checklist.')

export const createChecklistOutput = z.strictObject({
  checklist: z.looseObject({
    id: z.string().describe('Trello checklist ID.').optional(),
    cardId: z.string().describe('Trello card ID that owns the checklist.').optional(),
    name: z.string().describe('Checklist name.').optional(),
    checkItems: z.array(z.looseObject({
      id: z.string().describe('Trello check item ID.').optional(),
      name: z.string().describe('Check item name.').optional(),
      state: z.enum(['complete', 'incomplete']).describe('Check item state.').optional(),
      position: z.number().describe('Check item position in the checklist.').optional(),
    }).describe('A Trello checklist item returned by the REST API.')).describe('Checklist items returned by Trello.').optional(),
  }).describe('A Trello checklist returned by the REST API.').optional(),
}).describe('The created Trello checklist.')

export const listCardChecklistsInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
}).describe('Input parameters for listing Trello card checklists.')

export const listCardChecklistsOutput = z.strictObject({
  checklists: z.array(z.looseObject({
    id: z.string().describe('Trello checklist ID.').optional(),
    cardId: z.string().describe('Trello card ID that owns the checklist.').optional(),
    name: z.string().describe('Checklist name.').optional(),
    checkItems: z.array(z.looseObject({
      id: z.string().describe('Trello check item ID.').optional(),
      name: z.string().describe('Check item name.').optional(),
      state: z.enum(['complete', 'incomplete']).describe('Check item state.').optional(),
      position: z.number().describe('Check item position in the checklist.').optional(),
    }).describe('A Trello checklist item returned by the REST API.')).describe('Checklist items returned by Trello.').optional(),
  }).describe('A Trello checklist returned by the REST API.')).describe('Trello checklists.').optional(),
}).describe('Checklists returned by Trello.')

export const addCheckitemInput = z.strictObject({
  checklistId: z.string().min(1).describe('Trello checklist ID.'),
  name: z.string().min(1).describe('Check item name.'),
  position: z.union([z.enum(['top', 'bottom']).describe('Named list position.'), z.number().describe('Numeric list position.')]).describe('List position. Use top, bottom, or a numeric position.').optional(),
  checked: z.boolean().describe('Whether the new check item should be created as complete.').optional(),
}).describe('Input parameters for adding a Trello checklist item.')

export const addCheckitemOutput = z.strictObject({
  checkItem: z.looseObject({
    id: z.string().describe('Trello check item ID.').optional(),
    name: z.string().describe('Check item name.').optional(),
    state: z.enum(['complete', 'incomplete']).describe('Check item state.').optional(),
    position: z.number().describe('Check item position in the checklist.').optional(),
  }).describe('A Trello checklist item returned by the REST API.').optional(),
}).describe('The created Trello check item.')

export const updateCheckitemStateInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.').optional(),
  checkItemId: z.string().min(1).describe('Trello check item ID.').optional(),
  state: z.enum(['complete', 'incomplete']).describe('New check item state.').optional(),
}).describe('Input parameters for updating a Trello check item state.')

export const updateCheckitemStateOutput = z.strictObject({
  card: z.looseObject({
    id: z.string().describe('Trello card ID.').optional(),
    boardId: z.string().describe('Trello board ID that owns the card.').optional(),
    listId: z.string().describe('Trello list ID that contains the card.').optional(),
    name: z.string().describe('Card name.').optional(),
    description: z.string().describe('Card description.').optional(),
    url: z.url().describe('Public Trello card URL.').optional(),
    shortUrl: z.url().describe('Short Trello card URL.').optional(),
    closed: z.boolean().describe('Whether the card is closed.').optional(),
    due: z.iso.datetime({ offset: true }).describe('Card due date in ISO 8601 format.').nullable().optional(),
    dueComplete: z.boolean().describe('Whether the card due date is marked complete.').optional(),
  }).describe('A normalized Trello card returned by the REST API.').optional(),
}).describe('The Trello card returned after updating the check item.')

export const addCardAttachmentUrlInput = z.strictObject({
  cardId: z.string().min(1).describe('Trello card ID or short link.'),
  url: z.url().describe('URL to attach to the card.'),
  name: z.string().min(1).describe('Attachment display name.').optional(),
}).describe('Input parameters for attaching a URL to a Trello card.')

export const addCardAttachmentUrlOutput = z.strictObject({
  attachment: z.looseObject({
    id: z.string().describe('Trello attachment ID.').optional(),
    name: z.string().describe('Attachment name.').optional(),
    url: z.url().describe('Attachment URL.').optional(),
    bytes: z.int().describe('Attachment size in bytes.').nullable().optional(),
    date: z.iso.datetime({ offset: true }).describe('Attachment creation timestamp in ISO 8601 format.').optional(),
  }).describe('A Trello card attachment returned by the REST API.').optional(),
}).describe('The created Trello attachment.')

export const searchInput = z.strictObject({
  query: z.string().min(1).describe('Search query sent to Trello.'),
  modelTypes: z.array(z.enum(['actions', 'boards', 'cards', 'members', 'organizations']).describe('One Trello model type.')).min(1).describe('Trello model types to search.').optional(),
  cardsLimit: z.int().min(1).max(1000).describe('Maximum number of cards to return.').optional(),
  boardsLimit: z.int().min(1).max(1000).describe('Maximum number of boards to return.').optional(),
  membersLimit: z.int().min(1).max(1000).describe('Maximum number of members to return.').optional(),
}).describe('Input parameters for Trello search.')

export const searchOutput = z.strictObject({
  results: z.array(z.looseObject({}).describe('One Trello search result.')).describe('Search results returned by Trello.').optional(),
}).describe('Search results returned by Trello.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const trelloActions = {
  get_member: {
    description: 'Get a Trello member, defaulting to the authenticated member.',
    effect: 'read',
    inputSchema: getMemberInput,
    outputSchema: z.toJSONSchema(getMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_member_boards: {
    description: 'List Trello boards visible to a member.',
    effect: 'read',
    inputSchema: listMemberBoardsInput,
    outputSchema: z.toJSONSchema(listMemberBoardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_board: {
    description: 'Get a Trello board by ID.',
    effect: 'read',
    inputSchema: getBoardInput,
    outputSchema: z.toJSONSchema(getBoardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_board: {
    description: 'Create a Trello board.',
    effect: 'write',
    inputSchema: createBoardInput,
    outputSchema: z.toJSONSchema(createBoardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_board_lists: {
    description: 'List Trello lists on a board.',
    effect: 'read',
    inputSchema: listBoardListsInput,
    outputSchema: z.toJSONSchema(listBoardListsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_list: {
    description: 'Create a Trello list on a board.',
    effect: 'write',
    inputSchema: createListInput,
    outputSchema: z.toJSONSchema(createListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_list: {
    description: 'Update a Trello list name or position.',
    effect: 'write',
    inputSchema: updateListInput,
    outputSchema: z.toJSONSchema(updateListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  archive_list: {
    description: 'Archive a Trello list.',
    effect: 'write',
    inputSchema: archiveListInput,
    outputSchema: z.toJSONSchema(archiveListOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_board_cards: {
    description: 'List Trello cards on a board.',
    effect: 'read',
    inputSchema: listBoardCardsInput,
    outputSchema: z.toJSONSchema(listBoardCardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_board_members: {
    description: 'List Trello members on a board.',
    effect: 'read',
    inputSchema: listBoardMembersInput,
    outputSchema: z.toJSONSchema(listBoardMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_board_labels: {
    description: 'List Trello labels on a board.',
    effect: 'read',
    inputSchema: listBoardLabelsInput,
    outputSchema: z.toJSONSchema(listBoardLabelsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_card: {
    description: 'Get a Trello card by ID or short link.',
    effect: 'read',
    inputSchema: getCardInput,
    outputSchema: z.toJSONSchema(getCardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_card: {
    description: 'Create a Trello card in a list.',
    effect: 'write',
    inputSchema: createCardInput,
    outputSchema: z.toJSONSchema(createCardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  move_card: {
    description: 'Move a Trello card to another list.',
    effect: 'write',
    inputSchema: moveCardInput,
    outputSchema: z.toJSONSchema(moveCardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  archive_card: {
    description: 'Archive a Trello card.',
    effect: 'write',
    inputSchema: archiveCardInput,
    outputSchema: z.toJSONSchema(archiveCardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_card: {
    description: 'Update a Trello card by ID or short link.',
    effect: 'write',
    inputSchema: updateCardInput,
    outputSchema: z.toJSONSchema(updateCardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_card_comment: {
    description: 'Add a comment action to a Trello card.',
    effect: 'write',
    inputSchema: addCardCommentInput,
    outputSchema: z.toJSONSchema(addCardCommentOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_card_comments: {
    description: 'List comment actions on a Trello card.',
    effect: 'read',
    inputSchema: listCardCommentsInput,
    outputSchema: z.toJSONSchema(listCardCommentsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_card_member: {
    description: 'Assign a Trello member to a card.',
    effect: 'write',
    inputSchema: addCardMemberInput,
    outputSchema: z.toJSONSchema(addCardMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_card_member: {
    description: 'Remove a Trello member from a card.',
    effect: 'destructive',
    inputSchema: removeCardMemberInput,
    outputSchema: z.toJSONSchema(removeCardMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_card_label: {
    description: 'Add a Trello label to a card.',
    effect: 'write',
    inputSchema: addCardLabelInput,
    outputSchema: z.toJSONSchema(addCardLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_card_label: {
    description: 'Remove a Trello label from a card.',
    effect: 'destructive',
    inputSchema: removeCardLabelInput,
    outputSchema: z.toJSONSchema(removeCardLabelOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_checklist: {
    description: 'Create a Trello checklist on a card.',
    effect: 'write',
    inputSchema: createChecklistInput,
    outputSchema: z.toJSONSchema(createChecklistOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_card_checklists: {
    description: 'List Trello checklists on a card.',
    effect: 'read',
    inputSchema: listCardChecklistsInput,
    outputSchema: z.toJSONSchema(listCardChecklistsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_checkitem: {
    description: 'Add a check item to a Trello checklist.',
    effect: 'write',
    inputSchema: addCheckitemInput,
    outputSchema: z.toJSONSchema(addCheckitemOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_checkitem_state: {
    description: 'Update a Trello check item state on a card.',
    effect: 'write',
    inputSchema: updateCheckitemStateInput,
    outputSchema: z.toJSONSchema(updateCheckitemStateOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_card_attachment_url: {
    description: 'Attach an external URL to a Trello card.',
    effect: 'write',
    inputSchema: addCardAttachmentUrlInput,
    outputSchema: z.toJSONSchema(addCardAttachmentUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
  search: {
    description: 'Search Trello cards, boards, members, and organizations.',
    effect: 'write',
    inputSchema: searchInput,
    outputSchema: z.toJSONSchema(searchOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
