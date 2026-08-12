/**
 * V2EX 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listNotificationsInput = z.strictObject({
  p: z.int().min(1).describe('Optional page number to request. Defaults to 1.').optional(),
}).describe('Input parameters for fetching V2EX notifications.')

export const listNotificationsOutput = z.strictObject({
  notifications: z.array(z.looseObject({
    id: z.int().describe('The V2EX notification identifier.').optional(),
    member_id: z.int().describe('The member identifier that triggered the notification.').optional(),
    for_member_id: z.int().describe('The member identifier that received the notification.').optional(),
    text: z.string().describe('The notification text.').optional(),
    payload: z.string().describe('The notification payload string.').nullable().optional(),
    payload_rendered: z.string().describe('The rendered notification payload.').optional(),
    created: z.int().describe('The Unix timestamp when the notification was created.').optional(),
    member: z.looseObject({}).describe('The member object associated with the notification.').optional(),
  }).describe('A V2EX notification object.')).describe('The notifications returned for this page.'),
  total: z.int().describe('The total notification count parsed from the V2EX pagination message.'),
}).describe('The V2EX notifications response.')

export const deleteNotificationInput = z.strictObject({
  notification_id: z.int().min(1).describe('The V2EX numeric identifier.'),
}).describe('Input parameters for deleting a V2EX notification.')

export const deleteNotificationOutput = z.strictObject({
  success: z.boolean().describe('Whether the V2EX request was accepted.'),
}).describe('The empty response returned after V2EX accepts the request.')

export const listHotTopicsInput = z.strictObject({}).describe('Input parameters for fetching V2EX legacy hot topics.')

export const listHotTopicsOutput = z.strictObject({
  topics: z.array(z.looseObject({
    id: z.int().describe('The V2EX topic identifier.').optional(),
    title: z.string().describe('The topic title.').optional(),
    content: z.string().describe('The raw topic content.').optional(),
    content_rendered: z.string().describe('The rendered topic content.').optional(),
    url: z.url().describe('The V2EX URL for the topic.').optional(),
    replies: z.int().describe('The number of replies on the topic.').optional(),
    deleted: z.int().describe('Whether the topic has been deleted as returned by V2EX.').optional(),
    last_reply_by: z.string().describe('The username of the latest reply author, or empty string.').optional(),
    created: z.int().describe('The Unix timestamp when the topic was created.').optional(),
    last_modified: z.int().describe('The Unix timestamp when the topic was last modified.').optional(),
    last_touched: z.int().describe('The Unix timestamp when the topic was last touched.').optional(),
    member: z.looseObject({
      id: z.int().describe('The V2EX member identifier.').optional(),
      username: z.string().describe('The V2EX username.').optional(),
      url: z.url().describe('The V2EX URL for the member profile.').optional(),
      website: z.string().describe('The member website URL, empty string, or null.').nullable().optional(),
      twitter: z.string().describe('The member Twitter handle, empty string, or null.').nullable().optional(),
      psn: z.string().describe('The member PlayStation Network handle, empty string, or null.').nullable().optional(),
      github: z.string().describe('The member GitHub username, profile value, empty string, or null.').nullable().optional(),
      btc: z.string().describe('The member Bitcoin address, empty string, or null.').nullable().optional(),
      location: z.string().describe('The member location, empty string, or null.').nullable().optional(),
      tagline: z.string().describe('The member tagline, empty string, or null.').nullable().optional(),
      bio: z.string().describe('The member biography text, empty string, or null.').nullable().optional(),
      avatar_mini: z.url().describe('The mini avatar URL.').optional(),
      avatar_normal: z.url().describe('The normal avatar URL.').optional(),
      avatar_large: z.url().describe('The large avatar URL.').optional(),
      avatar_xlarge: z.url().describe('The extra-large avatar URL.').optional(),
      avatar_xxlarge: z.url().describe('The double extra-large avatar URL.').optional(),
      avatar_xxxlarge: z.url().describe('The triple extra-large avatar URL.').optional(),
      created: z.int().describe('The Unix timestamp when the member account was created.').optional(),
      last_modified: z.int().describe('The Unix timestamp when the member profile was last modified.').optional(),
      pro: z.int().describe('Whether the member has V2EX Pro status as returned by V2EX.').optional(),
    }).describe('A member object returned by the V2EX legacy public API.').optional(),
    node: z.looseObject({
      id: z.int().describe('The V2EX node identifier.').optional(),
      name: z.string().describe('The V2EX node name.').optional(),
      url: z.url().describe('The V2EX URL for the node.').optional(),
      title: z.string().describe('The human-readable node title.').optional(),
      title_alternative: z.string().describe('The alternative node title.').optional(),
      header: z.string().describe('The node header text.').optional(),
      footer: z.string().describe('The node footer text.').optional(),
      topics: z.int().describe('The number of topics in the node.').optional(),
      avatar_mini: z.url().describe('The mini node avatar URL.').optional(),
      avatar_normal: z.url().describe('The normal node avatar URL.').optional(),
      avatar_large: z.url().describe('The large node avatar URL.').optional(),
      stars: z.int().describe('The number of stars on the node.').optional(),
      founder_id: z.int().describe('The member identifier of the node founder.').optional(),
      aliases: z.array(z.string().describe('One node alias.')).describe('Alternative names for the node.').optional(),
      root: z.boolean().describe('Whether this node is a root node.').optional(),
      parent_node_name: z.string().describe('The parent node name, empty string, or null.').nullable().optional(),
    }).describe('A node object returned by the V2EX legacy public API.').optional(),
  }).describe('A topic object returned by the V2EX legacy public API.')).describe('The public topics returned by the V2EX legacy endpoint.'),
}).describe('The V2EX legacy public topic list response.')

export const listLatestTopicsInput = z.strictObject({}).describe('Input parameters for fetching V2EX legacy latest topics.')

export const listLatestTopicsOutput = z.strictObject({
  topics: z.array(z.looseObject({
    id: z.int().describe('The V2EX topic identifier.').optional(),
    title: z.string().describe('The topic title.').optional(),
    content: z.string().describe('The raw topic content.').optional(),
    content_rendered: z.string().describe('The rendered topic content.').optional(),
    url: z.url().describe('The V2EX URL for the topic.').optional(),
    replies: z.int().describe('The number of replies on the topic.').optional(),
    deleted: z.int().describe('Whether the topic has been deleted as returned by V2EX.').optional(),
    last_reply_by: z.string().describe('The username of the latest reply author, or empty string.').optional(),
    created: z.int().describe('The Unix timestamp when the topic was created.').optional(),
    last_modified: z.int().describe('The Unix timestamp when the topic was last modified.').optional(),
    last_touched: z.int().describe('The Unix timestamp when the topic was last touched.').optional(),
    member: z.looseObject({
      id: z.int().describe('The V2EX member identifier.').optional(),
      username: z.string().describe('The V2EX username.').optional(),
      url: z.url().describe('The V2EX URL for the member profile.').optional(),
      website: z.string().describe('The member website URL, empty string, or null.').nullable().optional(),
      twitter: z.string().describe('The member Twitter handle, empty string, or null.').nullable().optional(),
      psn: z.string().describe('The member PlayStation Network handle, empty string, or null.').nullable().optional(),
      github: z.string().describe('The member GitHub username, profile value, empty string, or null.').nullable().optional(),
      btc: z.string().describe('The member Bitcoin address, empty string, or null.').nullable().optional(),
      location: z.string().describe('The member location, empty string, or null.').nullable().optional(),
      tagline: z.string().describe('The member tagline, empty string, or null.').nullable().optional(),
      bio: z.string().describe('The member biography text, empty string, or null.').nullable().optional(),
      avatar_mini: z.url().describe('The mini avatar URL.').optional(),
      avatar_normal: z.url().describe('The normal avatar URL.').optional(),
      avatar_large: z.url().describe('The large avatar URL.').optional(),
      avatar_xlarge: z.url().describe('The extra-large avatar URL.').optional(),
      avatar_xxlarge: z.url().describe('The double extra-large avatar URL.').optional(),
      avatar_xxxlarge: z.url().describe('The triple extra-large avatar URL.').optional(),
      created: z.int().describe('The Unix timestamp when the member account was created.').optional(),
      last_modified: z.int().describe('The Unix timestamp when the member profile was last modified.').optional(),
      pro: z.int().describe('Whether the member has V2EX Pro status as returned by V2EX.').optional(),
    }).describe('A member object returned by the V2EX legacy public API.').optional(),
    node: z.looseObject({
      id: z.int().describe('The V2EX node identifier.').optional(),
      name: z.string().describe('The V2EX node name.').optional(),
      url: z.url().describe('The V2EX URL for the node.').optional(),
      title: z.string().describe('The human-readable node title.').optional(),
      title_alternative: z.string().describe('The alternative node title.').optional(),
      header: z.string().describe('The node header text.').optional(),
      footer: z.string().describe('The node footer text.').optional(),
      topics: z.int().describe('The number of topics in the node.').optional(),
      avatar_mini: z.url().describe('The mini node avatar URL.').optional(),
      avatar_normal: z.url().describe('The normal node avatar URL.').optional(),
      avatar_large: z.url().describe('The large node avatar URL.').optional(),
      stars: z.int().describe('The number of stars on the node.').optional(),
      founder_id: z.int().describe('The member identifier of the node founder.').optional(),
      aliases: z.array(z.string().describe('One node alias.')).describe('Alternative names for the node.').optional(),
      root: z.boolean().describe('Whether this node is a root node.').optional(),
      parent_node_name: z.string().describe('The parent node name, empty string, or null.').nullable().optional(),
    }).describe('A node object returned by the V2EX legacy public API.').optional(),
  }).describe('A topic object returned by the V2EX legacy public API.')).describe('The public topics returned by the V2EX legacy endpoint.'),
}).describe('The V2EX legacy public topic list response.')

export const getCurrentMemberInput = z.strictObject({}).describe('Input parameters for fetching the authenticated V2EX member.')

export const getCurrentMemberOutput = z.strictObject({
  member: z.looseObject({
    id: z.int().describe('The V2EX member identifier.').optional(),
    username: z.string().describe('The V2EX username.').optional(),
    url: z.url().describe('The V2EX URL for the member profile.').optional(),
    website: z.string().describe('The member website URL or empty string.').optional(),
    twitter: z.string().describe('The member Twitter handle or empty string.').optional(),
    psn: z.string().describe('The member PlayStation Network handle or empty string.').optional(),
    github: z.string().describe('The member GitHub username or profile value.').optional(),
    btc: z.string().describe('The member Bitcoin address or empty string.').optional(),
    location: z.string().describe('The member location or empty string.').optional(),
    tagline: z.string().describe('The member tagline or empty string.').optional(),
    bio: z.string().describe('The member biography text.').optional(),
    avatar_mini: z.url().describe('The mini avatar URL.').optional(),
    avatar_normal: z.url().describe('The normal avatar URL.').optional(),
    avatar_large: z.url().describe('The large avatar URL.').optional(),
    created: z.int().describe('The Unix timestamp when the member account was created.').optional(),
    last_modified: z.int().describe('The Unix timestamp when the profile was last modified.').optional(),
    pro: z.int().describe('Whether the member has V2EX Pro status as returned by V2EX.').optional(),
  }).describe('The authenticated V2EX member profile.'),
}).describe('The V2EX member profile response.')

export const getCurrentTokenInput = z.strictObject({}).describe('Input parameters for fetching current V2EX token metadata.')

export const getCurrentTokenOutput = z.strictObject({
  token: z.looseObject({
    token: z.string().describe('The token value as returned by V2EX. It may be masked after creation.').optional(),
    scope: z.enum(['everything', 'regular']).describe('The token scope.').optional(),
    expiration: z.int().describe('The token lifetime in seconds.').optional(),
    good_for_days: z.int().describe('The remaining token lifetime in days.').optional(),
    total_used: z.int().describe('The total number of times the token has been used.').optional(),
    last_used: z.int().describe('The Unix timestamp when the token was last used.').optional(),
    created: z.int().describe('The Unix timestamp when the token was created.').optional(),
  }).describe('Metadata for a V2EX Personal Access Token.'),
}).describe('The V2EX token metadata response.')

export const createTokenInput = z.strictObject({
  scope: z.enum(['everything', 'regular']).describe('The access scope for the new V2EX token.'),
  expiration: z.union([z.literal(2592000).describe('A 30-day token lifetime in seconds.'), z.literal(5184000).describe('A 60-day token lifetime in seconds.'), z.literal(7776000).describe('A 90-day token lifetime in seconds.'), z.literal(15552000).describe('A 180-day token lifetime in seconds.')]).describe('The token lifetime in seconds.'),
}).describe('Input parameters for creating a V2EX Personal Access Token.')

export const createTokenOutput = z.strictObject({
  token: z.string().describe('The newly created Personal Access Token value.'),
}).describe('The V2EX token creation response.')

export const getNodeInput = z.strictObject({
  node_name: z.string().min(1).describe('The V2EX node name, such as `python`.'),
}).describe('Input parameters for fetching a V2EX node.')

export const getNodeOutput = z.strictObject({
  node: z.looseObject({
    id: z.int().describe('The V2EX node identifier.').optional(),
    founder_id: z.int().describe('The member identifier of the node founder.').optional(),
    url: z.url().describe('The V2EX URL for the node.').optional(),
    name: z.string().describe('The V2EX node name.').optional(),
    title: z.string().describe('The human-readable node title.').optional(),
    header: z.string().describe('The node header text.').optional(),
    footer: z.string().describe('The node footer text.').optional(),
    avatar: z.url().describe('The node avatar URL.').optional(),
    topics: z.int().describe('The number of topics in the node.').optional(),
    created: z.int().describe('The Unix timestamp when the node was created.').optional(),
    last_modified: z.int().describe('The Unix timestamp when the node was last modified.').optional(),
  }).describe('A V2EX node object.'),
}).describe('The V2EX node response.')

export const listNodeTopicsInput = z.strictObject({
  node_name: z.string().min(1).describe('The V2EX node name, such as `python`.'),
  p: z.int().min(1).describe('Optional page number to request. Defaults to 1.').optional(),
}).describe('Input parameters for fetching topics from a V2EX node.')

export const listNodeTopicsOutput = z.strictObject({
  topics: z.array(z.looseObject({
    id: z.int().describe('The V2EX topic identifier.').optional(),
    title: z.string().describe('The topic title.').optional(),
    content: z.string().describe('The raw topic content.').optional(),
    content_rendered: z.string().describe('The rendered topic content.').optional(),
    syntax: z.int().describe('The content syntax mode returned by V2EX.').optional(),
    url: z.url().describe('The V2EX URL for the topic.').optional(),
    replies: z.int().describe('The number of replies on the topic.').optional(),
    stars: z.int().describe('The number of stars on the topic.').optional(),
    thanks: z.int().describe('The number of thanks on the topic.').optional(),
    last_reply_by: z.string().describe('The username of the latest reply author, or empty string.').optional(),
    created: z.int().describe('The Unix timestamp when the topic was created.').optional(),
    last_modified: z.int().describe('The Unix timestamp when the topic was last modified.').optional(),
    last_touched: z.int().describe('The Unix timestamp when the topic was last touched.').optional(),
    member: z.looseObject({
      id: z.int().describe('The V2EX member identifier.').optional(),
      username: z.string().describe('The V2EX username.').optional(),
      bio: z.string().describe('The member biography text.').optional(),
      website: z.string().describe('The member website URL or empty string.').optional(),
      github: z.string().describe('The member GitHub username or profile value.').optional(),
      url: z.url().describe('The V2EX URL for the member profile.').optional(),
      avatar: z.url().describe('The member avatar URL.').optional(),
      created: z.int().describe('The Unix timestamp when the member account was created.').optional(),
      pro: z.int().describe('Whether the member has V2EX Pro status as returned by V2EX.').optional(),
    }).describe('A compact V2EX member object.').optional(),
    node: z.looseObject({
      id: z.int().describe('The V2EX node identifier.').optional(),
      founder_id: z.int().describe('The member identifier of the node founder.').optional(),
      url: z.url().describe('The V2EX URL for the node.').optional(),
      name: z.string().describe('The V2EX node name.').optional(),
      title: z.string().describe('The human-readable node title.').optional(),
      header: z.string().describe('The node header text.').optional(),
      footer: z.string().describe('The node footer text.').optional(),
      avatar: z.url().describe('The node avatar URL.').optional(),
      topics: z.int().describe('The number of topics in the node.').optional(),
      created: z.int().describe('The Unix timestamp when the node was created.').optional(),
      last_modified: z.int().describe('The Unix timestamp when the node was last modified.').optional(),
    }).describe('A V2EX node object.').optional(),
    supplements: z.array(z.unknown().describe('One supplement.')).describe('Supplement objects attached to the topic.').optional(),
  }).describe('A V2EX topic object.')).describe('The topics returned for this node page.'),
}).describe('The V2EX node topics response.')

export const getTopicInput = z.strictObject({
  topic_id: z.int().min(1).describe('The V2EX numeric identifier.'),
}).describe('Input parameters for fetching a V2EX topic.')

export const getTopicOutput = z.strictObject({
  topic: z.looseObject({
    id: z.int().describe('The V2EX topic identifier.').optional(),
    title: z.string().describe('The topic title.').optional(),
    content: z.string().describe('The raw topic content.').optional(),
    content_rendered: z.string().describe('The rendered topic content.').optional(),
    syntax: z.int().describe('The content syntax mode returned by V2EX.').optional(),
    url: z.url().describe('The V2EX URL for the topic.').optional(),
    replies: z.int().describe('The number of replies on the topic.').optional(),
    stars: z.int().describe('The number of stars on the topic.').optional(),
    thanks: z.int().describe('The number of thanks on the topic.').optional(),
    last_reply_by: z.string().describe('The username of the latest reply author, or empty string.').optional(),
    created: z.int().describe('The Unix timestamp when the topic was created.').optional(),
    last_modified: z.int().describe('The Unix timestamp when the topic was last modified.').optional(),
    last_touched: z.int().describe('The Unix timestamp when the topic was last touched.').optional(),
    member: z.looseObject({
      id: z.int().describe('The V2EX member identifier.').optional(),
      username: z.string().describe('The V2EX username.').optional(),
      bio: z.string().describe('The member biography text.').optional(),
      website: z.string().describe('The member website URL or empty string.').optional(),
      github: z.string().describe('The member GitHub username or profile value.').optional(),
      url: z.url().describe('The V2EX URL for the member profile.').optional(),
      avatar: z.url().describe('The member avatar URL.').optional(),
      created: z.int().describe('The Unix timestamp when the member account was created.').optional(),
      pro: z.int().describe('Whether the member has V2EX Pro status as returned by V2EX.').optional(),
    }).describe('A compact V2EX member object.').optional(),
    node: z.looseObject({
      id: z.int().describe('The V2EX node identifier.').optional(),
      founder_id: z.int().describe('The member identifier of the node founder.').optional(),
      url: z.url().describe('The V2EX URL for the node.').optional(),
      name: z.string().describe('The V2EX node name.').optional(),
      title: z.string().describe('The human-readable node title.').optional(),
      header: z.string().describe('The node header text.').optional(),
      footer: z.string().describe('The node footer text.').optional(),
      avatar: z.url().describe('The node avatar URL.').optional(),
      topics: z.int().describe('The number of topics in the node.').optional(),
      created: z.int().describe('The Unix timestamp when the node was created.').optional(),
      last_modified: z.int().describe('The Unix timestamp when the node was last modified.').optional(),
    }).describe('A V2EX node object.').optional(),
    supplements: z.array(z.unknown().describe('One supplement.')).describe('Supplement objects attached to the topic.').optional(),
  }).describe('A V2EX topic object.'),
}).describe('The V2EX topic response.')

export const listTopicRepliesInput = z.strictObject({
  topic_id: z.int().min(1).describe('The V2EX numeric identifier.'),
  p: z.int().min(1).describe('Optional page number to request. Defaults to 1.').optional(),
}).describe('Input parameters for fetching replies for a V2EX topic.')

export const listTopicRepliesOutput = z.strictObject({
  replies: z.array(z.looseObject({
    id: z.int().describe('The V2EX reply identifier.').optional(),
    content: z.string().describe('The raw reply content.').optional(),
    content_rendered: z.string().describe('The rendered reply content.').optional(),
    created: z.int().describe('The Unix timestamp when the reply was created.').optional(),
    member: z.looseObject({
      id: z.int().describe('The V2EX member identifier.').optional(),
      username: z.string().describe('The V2EX username.').optional(),
      bio: z.string().describe('The member biography text.').optional(),
      website: z.string().describe('The member website URL or empty string.').optional(),
      github: z.string().describe('The member GitHub username or profile value.').optional(),
      url: z.url().describe('The V2EX URL for the member profile.').optional(),
      avatar: z.url().describe('The member avatar URL.').optional(),
      created: z.int().describe('The Unix timestamp when the member account was created.').optional(),
      pro: z.int().describe('Whether the member has V2EX Pro status as returned by V2EX.').optional(),
    }).describe('A compact V2EX member object.').optional(),
  }).describe('A V2EX topic reply object.')).describe('The replies returned for this topic page.'),
}).describe('The V2EX topic replies response.')

export const setTopicStickyInput = z.strictObject({
  topic_id: z.int().min(1).describe('The V2EX numeric identifier.'),
  duration: z.enum(['15min', '1hr', '8hr']).describe('Optional sticky duration. Defaults to 15min.').optional(),
}).describe('Input parameters for setting a V2EX topic as sticky.')

export const setTopicStickyOutput = z.strictObject({
  success: z.boolean().describe('Whether the V2EX request was accepted.'),
}).describe('The empty response returned after V2EX accepts the request.')

export const boostTopicInput = z.strictObject({
  topic_id: z.int().min(1).describe('The V2EX numeric identifier.'),
}).describe('Input parameters for boosting a V2EX topic.')

export const boostTopicOutput = z.strictObject({
  success: z.boolean().describe('Whether the V2EX request was accepted.'),
}).describe('The empty response returned after V2EX accepts the request.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const v2exActions = {
  list_notifications: {
    description: 'Fetch the latest V2EX notifications for the authenticated member.',
    effect: 'read',
    inputSchema: listNotificationsInput,
    outputSchema: z.toJSONSchema(listNotificationsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_notification: {
    description: 'Delete one V2EX notification by its numeric identifier.',
    effect: 'destructive',
    inputSchema: deleteNotificationInput,
    outputSchema: z.toJSONSchema(deleteNotificationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_hot_topics: {
    description: 'Fetch public hot topics from the V2EX legacy JSON API.',
    effect: 'read',
    inputSchema: listHotTopicsInput,
    outputSchema: z.toJSONSchema(listHotTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_latest_topics: {
    description: 'Fetch public latest topics from the V2EX legacy JSON API.',
    effect: 'read',
    inputSchema: listLatestTopicsInput,
    outputSchema: z.toJSONSchema(listLatestTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_member: {
    description: 'Fetch the authenticated V2EX member profile.',
    effect: 'read',
    inputSchema: getCurrentMemberInput,
    outputSchema: z.toJSONSchema(getCurrentMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_token: {
    description: 'Fetch metadata for the V2EX Personal Access Token used by this connection.',
    effect: 'read',
    inputSchema: getCurrentTokenInput,
    outputSchema: z.toJSONSchema(getCurrentTokenOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_token: {
    description: 'Create a new V2EX Personal Access Token from an existing token.',
    effect: 'write',
    inputSchema: createTokenInput,
    outputSchema: z.toJSONSchema(createTokenOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_node: {
    description: 'Fetch a V2EX node by node name.',
    effect: 'read',
    inputSchema: getNodeInput,
    outputSchema: z.toJSONSchema(getNodeOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_node_topics: {
    description: 'Fetch topics from a V2EX node.',
    effect: 'read',
    inputSchema: listNodeTopicsInput,
    outputSchema: z.toJSONSchema(listNodeTopicsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_topic: {
    description: 'Fetch a V2EX topic by numeric identifier.',
    effect: 'read',
    inputSchema: getTopicInput,
    outputSchema: z.toJSONSchema(getTopicOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_topic_replies: {
    description: 'Fetch replies for a V2EX topic.',
    effect: 'read',
    inputSchema: listTopicRepliesInput,
    outputSchema: z.toJSONSchema(listTopicRepliesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  set_topic_sticky: {
    description: 'Set one of the authenticated member\'s V2EX topics as sticky.',
    effect: 'write',
    inputSchema: setTopicStickyInput,
    outputSchema: z.toJSONSchema(setTopicStickyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  boost_topic: {
    description: 'Boost one of the authenticated member\'s V2EX topics to the homepage.',
    effect: 'write',
    inputSchema: boostTopicInput,
    outputSchema: z.toJSONSchema(boostTopicOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
