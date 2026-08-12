/**
 * Docker Hub 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listRepositoriesInput = z.strictObject({
  namespace: z.string().min(1).describe('The namespace that owns the repositories.'),
  page: z.int().min(1).describe('The page number to retrieve.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of results to return per page.').optional(),
  name: z.string().min(1).describe('An optional partial repository name filter.').optional(),
  ordering: z.enum(['name', '-name', 'last_updated', '-last_updated', 'pull_count', '-pull_count']).describe('The field and direction used to order repositories.').optional(),
}).describe('The input payload for this action.')

export const listRepositoriesOutput = z.strictObject({
  count: z.int().describe('The total number of matching items.'),
  next: z.string().describe('The URL for the next page, or null when unavailable.').nullable(),
  previous: z.string().describe('The URL for the previous page, or null when unavailable.').nullable(),
  results: z.array(z.strictObject({
    name: z.string().describe('The repository name.').optional(),
    namespace: z.string().describe('The namespace that owns the repository.').optional(),
    repositoryType: z.string().describe('The repository type, such as image or plugin.').nullable().optional(),
    status: z.int().describe('The numeric repository status code.').optional(),
    statusDescription: z.string().describe('The human-readable repository status.').optional(),
    description: z.string().describe('The short repository description, when available.').nullable().optional(),
    isPrivate: z.boolean().describe('Whether the repository is private.').optional(),
    starCount: z.int().describe('The number of stars on the repository.').optional(),
    pullCount: z.int().describe('The total number of pulls for the repository.').optional(),
    lastUpdated: z.string().describe('The ISO 8601 timestamp when the repository was last updated.').nullable().optional(),
    lastModified: z.string().describe('The ISO 8601 timestamp when the repository was last modified.').nullable().optional(),
    dateRegistered: z.string().describe('The ISO 8601 timestamp when the repository was created.').nullable().optional(),
    affiliation: z.string().describe('The current user\'s affiliation with the repository, when available.').nullable().optional(),
    mediaTypes: z.array(z.string().min(1)).describe('The media types supported by the repository.').optional(),
    contentTypes: z.array(z.string().min(1)).describe('The content types supported by the repository.').optional(),
    categories: z.array(z.strictObject({
      name: z.string().describe('The human-readable repository category name.').optional(),
      slug: z.string().describe('The URL-friendly repository category identifier.').optional(),
    }).describe('A Docker Hub repository category.')).describe('The categories assigned to the repository.').optional(),
    storageSize: z.int().describe('The repository storage size in bytes, when available.').nullable().optional(),
  }).describe('A Docker Hub repository summary.')).describe('The items in the current page.'),
}).describe('A paginated Docker Hub repository list.')

export const getRepositoryInput = z.strictObject({
  namespace: z.string().min(1).describe('The namespace that owns the repository.'),
  repository: z.string().min(1).describe('The repository name.'),
}).describe('The input payload for this action.')

export const getRepositoryOutput = z.strictObject({
  repository: z.strictObject({
    name: z.string().describe('The repository name.').optional(),
    namespace: z.string().describe('The namespace that owns the repository.').optional(),
    repositoryType: z.string().describe('The repository type, such as image or plugin.').nullable().optional(),
    status: z.int().describe('The numeric repository status code.').optional(),
    statusDescription: z.string().describe('The human-readable repository status.').optional(),
    description: z.string().describe('The short repository description, when available.').nullable().optional(),
    isPrivate: z.boolean().describe('Whether the repository is private.').optional(),
    starCount: z.int().describe('The number of stars on the repository.').optional(),
    pullCount: z.int().describe('The total number of pulls for the repository.').optional(),
    lastUpdated: z.string().describe('The ISO 8601 timestamp when the repository was last updated.').nullable().optional(),
    lastModified: z.string().describe('The ISO 8601 timestamp when the repository was last modified.').nullable().optional(),
    dateRegistered: z.string().describe('The ISO 8601 timestamp when the repository was created.').nullable().optional(),
    affiliation: z.string().describe('The current user\'s affiliation with the repository, when available.').nullable().optional(),
    mediaTypes: z.array(z.string().min(1)).describe('The media types supported by the repository.').optional(),
    contentTypes: z.array(z.string().min(1)).describe('The content types supported by the repository.').optional(),
    categories: z.array(z.strictObject({
      name: z.string().describe('The human-readable repository category name.').optional(),
      slug: z.string().describe('The URL-friendly repository category identifier.').optional(),
    }).describe('A Docker Hub repository category.')).describe('The categories assigned to the repository.').optional(),
    storageSize: z.int().describe('The repository storage size in bytes, when available.').nullable().optional(),
    user: z.string().describe('The repository owner username, when available.').nullable().optional(),
    hubUser: z.string().describe('The Docker Hub user associated with the repository, when available.').nullable().optional(),
    collaboratorCount: z.int().describe('The number of collaborators on the repository, when available.').nullable().optional(),
    fullDescription: z.string().describe('The full repository description, when available.').nullable().optional(),
    hasStarred: z.boolean().describe('Whether the current user has starred the repository, when available.').nullable().optional(),
    permissions: z.strictObject({
      read: z.boolean().describe('Whether read access is available.').optional(),
      write: z.boolean().describe('Whether write access is available.').optional(),
      admin: z.boolean().describe('Whether admin access is available.').optional(),
    }).describe('The repository permissions visible to the current credential.').nullable().optional(),
    immutableTagsSettings: z.strictObject({
      enabled: z.boolean().describe('Whether immutable tags are enabled for the repository.').optional(),
      rules: z.array(z.string().min(1)).describe('The immutable tag rules configured for the repository.').optional(),
    }).describe('The immutable tag configuration for the repository.').nullable().optional(),
    source: z.string().describe('The repository source metadata, when available.').nullable().optional(),
  }).describe('Detailed Docker Hub repository metadata.'),
}).describe('The output payload for retrieving a Docker Hub repository.')

export const createRepositoryInput = z.strictObject({
  namespace: z.string().min(1).describe('The namespace where the repository should be created.'),
  name: z.string().min(2).max(255).describe('The repository name to create.'),
  description: z.string().max(100).describe('The short repository description.').optional(),
  fullDescription: z.string().max(25000).describe('The detailed repository description.').optional(),
  registry: z.string().describe('The registry where the repository should be hosted.').optional(),
  isPrivate: z.boolean().describe('Whether the repository should be created as private.').optional(),
}).describe('The input payload for this action.')

export const createRepositoryOutput = z.strictObject({
  repository: z.strictObject({
    name: z.string().describe('The repository name.').optional(),
    namespace: z.string().describe('The namespace that owns the repository.').optional(),
    repositoryType: z.string().describe('The repository type, such as image or plugin.').nullable().optional(),
    status: z.int().describe('The numeric repository status code.').optional(),
    statusDescription: z.string().describe('The human-readable repository status.').optional(),
    description: z.string().describe('The short repository description, when available.').nullable().optional(),
    isPrivate: z.boolean().describe('Whether the repository is private.').optional(),
    starCount: z.int().describe('The number of stars on the repository.').optional(),
    pullCount: z.int().describe('The total number of pulls for the repository.').optional(),
    lastUpdated: z.string().describe('The ISO 8601 timestamp when the repository was last updated.').nullable().optional(),
    lastModified: z.string().describe('The ISO 8601 timestamp when the repository was last modified.').nullable().optional(),
    dateRegistered: z.string().describe('The ISO 8601 timestamp when the repository was created.').nullable().optional(),
    affiliation: z.string().describe('The current user\'s affiliation with the repository, when available.').nullable().optional(),
    mediaTypes: z.array(z.string().min(1)).describe('The media types supported by the repository.').optional(),
    contentTypes: z.array(z.string().min(1)).describe('The content types supported by the repository.').optional(),
    categories: z.array(z.strictObject({
      name: z.string().describe('The human-readable repository category name.').optional(),
      slug: z.string().describe('The URL-friendly repository category identifier.').optional(),
    }).describe('A Docker Hub repository category.')).describe('The categories assigned to the repository.').optional(),
    storageSize: z.int().describe('The repository storage size in bytes, when available.').nullable().optional(),
    user: z.string().describe('The repository owner username, when available.').nullable().optional(),
    hubUser: z.string().describe('The Docker Hub user associated with the repository, when available.').nullable().optional(),
    collaboratorCount: z.int().describe('The number of collaborators on the repository, when available.').nullable().optional(),
    fullDescription: z.string().describe('The full repository description, when available.').nullable().optional(),
    hasStarred: z.boolean().describe('Whether the current user has starred the repository, when available.').nullable().optional(),
    permissions: z.strictObject({
      read: z.boolean().describe('Whether read access is available.').optional(),
      write: z.boolean().describe('Whether write access is available.').optional(),
      admin: z.boolean().describe('Whether admin access is available.').optional(),
    }).describe('The repository permissions visible to the current credential.').nullable().optional(),
    immutableTagsSettings: z.strictObject({
      enabled: z.boolean().describe('Whether immutable tags are enabled for the repository.').optional(),
      rules: z.array(z.string().min(1)).describe('The immutable tag rules configured for the repository.').optional(),
    }).describe('The immutable tag configuration for the repository.').nullable().optional(),
    source: z.string().describe('The repository source metadata, when available.').nullable().optional(),
  }).describe('Detailed Docker Hub repository metadata.'),
}).describe('The output payload for creating a Docker Hub repository.')

export const getTagInput = z.strictObject({
  namespace: z.string().min(1).describe('The namespace that owns the repository.'),
  repository: z.string().min(1).describe('The repository name.'),
  tag: z.string().min(1).describe('The tag name to retrieve.'),
}).describe('The input payload for this action.')

export const getTagOutput = z.strictObject({
  tag: z.strictObject({
    id: z.int().describe('The numeric tag identifier, when available.').nullable().optional(),
    name: z.string().describe('The repository tag name.').optional(),
    creator: z.int().describe('The user ID that originally created the tag.').nullable().optional(),
    lastUpdated: z.string().describe('The ISO 8601 timestamp when the tag was last updated.').nullable().optional(),
    lastUpdater: z.int().describe('The user ID that last updated the tag.').nullable().optional(),
    lastUpdaterUsername: z.string().describe('The Docker Hub username that last updated the tag.').nullable().optional(),
    repository: z.int().describe('The numeric repository identifier.').nullable().optional(),
    fullSize: z.int().describe('The compressed tag size in bytes.').nullable().optional(),
    status: z.string().describe('The current Docker Hub tag status.').nullable().optional(),
    tagLastPulled: z.string().describe('The ISO 8601 timestamp when the tag was last pulled.').nullable().optional(),
    tagLastPushed: z.string().describe('The ISO 8601 timestamp when the tag was last pushed.').nullable().optional(),
    images: z.array(z.strictObject({
      architecture: z.string().describe('The CPU architecture for the image variant, when available.').nullable().optional(),
      features: z.string().describe('The CPU feature set reported for the image variant, when available.').nullable().optional(),
      variant: z.string().describe('The CPU variant reported for the image variant, when available.').nullable().optional(),
      digest: z.string().describe('The image manifest digest, when available.').nullable().optional(),
      layers: z.array(z.strictObject({
        digest: z.string().describe('The image layer digest, when available.').nullable().optional(),
        size: z.int().describe('The image layer size in bytes, when available.').nullable().optional(),
        instruction: z.string().describe('The Dockerfile instruction associated with the layer, when available.').nullable().optional(),
      }).describe('A Docker image layer.')).describe('The image layers included in the image variant.').optional(),
      os: z.string().describe('The operating system for the image variant, when available.').nullable().optional(),
      osFeatures: z.string().describe('The operating system features reported for the image variant, when available.').nullable().optional(),
      osVersion: z.string().describe('The operating system version for the image variant, when available.').nullable().optional(),
      size: z.int().describe('The image size in bytes, when available.').nullable().optional(),
      status: z.string().describe('The image status returned by Docker Hub, when available.').nullable().optional(),
      lastPulled: z.string().describe('The ISO 8601 timestamp when the image variant was last pulled.').nullable().optional(),
      lastPushed: z.string().describe('The ISO 8601 timestamp when the image variant was last pushed.').nullable().optional(),
    }).describe('A platform-specific Docker image variant.')).describe('The image variants currently published for the tag.').optional(),
  }).describe('A Docker Hub repository tag.'),
}).describe('The output payload for retrieving a Docker Hub repository tag.')

export const getImageInput = z.strictObject({
  namespace: z.string().min(1).describe('The namespace that owns the repository.'),
  repository: z.string().min(1).describe('The repository name.'),
  digest: z.string().min(1).describe('The image manifest digest to look up.'),
  pageSize: z.int().min(1).max(100).describe('The number of results to return per page.').optional(),
  maxPages: z.int().min(1).max(100).describe('The maximum number of tag pages to scan.').optional(),
}).describe('The input payload for this action.')

export const getImageOutput = z.strictObject({
  tag: z.strictObject({
    id: z.int().describe('The numeric tag identifier, when available.').nullable().optional(),
    name: z.string().describe('The repository tag name.').optional(),
    creator: z.int().describe('The user ID that originally created the tag.').nullable().optional(),
    lastUpdated: z.string().describe('The ISO 8601 timestamp when the tag was last updated.').nullable().optional(),
    lastUpdater: z.int().describe('The user ID that last updated the tag.').nullable().optional(),
    lastUpdaterUsername: z.string().describe('The Docker Hub username that last updated the tag.').nullable().optional(),
    repository: z.int().describe('The numeric repository identifier.').nullable().optional(),
    fullSize: z.int().describe('The compressed tag size in bytes.').nullable().optional(),
    status: z.string().describe('The current Docker Hub tag status.').nullable().optional(),
    tagLastPulled: z.string().describe('The ISO 8601 timestamp when the tag was last pulled.').nullable().optional(),
    tagLastPushed: z.string().describe('The ISO 8601 timestamp when the tag was last pushed.').nullable().optional(),
    images: z.array(z.strictObject({
      architecture: z.string().describe('The CPU architecture for the image variant, when available.').nullable().optional(),
      features: z.string().describe('The CPU feature set reported for the image variant, when available.').nullable().optional(),
      variant: z.string().describe('The CPU variant reported for the image variant, when available.').nullable().optional(),
      digest: z.string().describe('The image manifest digest, when available.').nullable().optional(),
      layers: z.array(z.strictObject({
        digest: z.string().describe('The image layer digest, when available.').nullable().optional(),
        size: z.int().describe('The image layer size in bytes, when available.').nullable().optional(),
        instruction: z.string().describe('The Dockerfile instruction associated with the layer, when available.').nullable().optional(),
      }).describe('A Docker image layer.')).describe('The image layers included in the image variant.').optional(),
      os: z.string().describe('The operating system for the image variant, when available.').nullable().optional(),
      osFeatures: z.string().describe('The operating system features reported for the image variant, when available.').nullable().optional(),
      osVersion: z.string().describe('The operating system version for the image variant, when available.').nullable().optional(),
      size: z.int().describe('The image size in bytes, when available.').nullable().optional(),
      status: z.string().describe('The image status returned by Docker Hub, when available.').nullable().optional(),
      lastPulled: z.string().describe('The ISO 8601 timestamp when the image variant was last pulled.').nullable().optional(),
      lastPushed: z.string().describe('The ISO 8601 timestamp when the image variant was last pushed.').nullable().optional(),
    }).describe('A platform-specific Docker image variant.')).describe('The image variants currently published for the tag.').optional(),
  }).describe('A Docker Hub repository tag.'),
  image: z.strictObject({
    architecture: z.string().describe('The CPU architecture for the image variant, when available.').nullable().optional(),
    features: z.string().describe('The CPU feature set reported for the image variant, when available.').nullable().optional(),
    variant: z.string().describe('The CPU variant reported for the image variant, when available.').nullable().optional(),
    digest: z.string().describe('The image manifest digest, when available.').nullable().optional(),
    layers: z.array(z.strictObject({
      digest: z.string().describe('The image layer digest, when available.').nullable().optional(),
      size: z.int().describe('The image layer size in bytes, when available.').nullable().optional(),
      instruction: z.string().describe('The Dockerfile instruction associated with the layer, when available.').nullable().optional(),
    }).describe('A Docker image layer.')).describe('The image layers included in the image variant.').optional(),
    os: z.string().describe('The operating system for the image variant, when available.').nullable().optional(),
    osFeatures: z.string().describe('The operating system features reported for the image variant, when available.').nullable().optional(),
    osVersion: z.string().describe('The operating system version for the image variant, when available.').nullable().optional(),
    size: z.int().describe('The image size in bytes, when available.').nullable().optional(),
    status: z.string().describe('The image status returned by Docker Hub, when available.').nullable().optional(),
    lastPulled: z.string().describe('The ISO 8601 timestamp when the image variant was last pulled.').nullable().optional(),
    lastPushed: z.string().describe('The ISO 8601 timestamp when the image variant was last pushed.').nullable().optional(),
  }).describe('A platform-specific Docker image variant.'),
}).describe('The output payload for searching a Docker Hub image by digest.')

export const listOrgMembersInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  search: z.string().describe('An optional member search term.').optional(),
  page: z.int().min(1).describe('The page number to retrieve.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of results to return per page.').optional(),
  invites: z.boolean().describe('Whether to include invites in the response when supported.').optional(),
  type: z.enum(['all', 'invitee', 'member']).describe('The member type filter.').optional(),
  role: z.enum(['owner', 'editor', 'member']).describe('The organization role filter.').optional(),
}).describe('The input payload for this action.')

export const listOrgMembersOutput = z.strictObject({
  count: z.int().describe('The total number of matching items.'),
  next: z.string().describe('The URL for the next page, or null when unavailable.').nullable(),
  previous: z.string().describe('The URL for the previous page, or null when unavailable.').nullable(),
  results: z.array(z.strictObject({
    id: z.string().describe('The member identifier, when available.').nullable().optional(),
    username: z.string().describe('The Docker Hub username of the member.').nullable().optional(),
    fullName: z.string().describe('The full name of the member, when available.').nullable().optional(),
    email: z.string().describe('The email address of the member, when available.').nullable().optional(),
    type: z.string().describe('The Docker Hub member type, when available.').nullable().optional(),
    role: z.string().describe('The organization role assigned to the member.').nullable().optional(),
    groups: z.array(z.string().min(1)).describe('The teams that include the member.').optional(),
    isGuest: z.boolean().describe('Whether the member is marked as a guest in the organization.').nullable().optional(),
    dateJoined: z.string().describe('The ISO 8601 timestamp when the member joined the organization.').nullable().optional(),
    lastLoggedInAt: z.string().describe('The ISO 8601 timestamp when the member last logged in, when visible.').nullable().optional(),
    lastSeenAt: z.string().describe('The ISO 8601 timestamp when the member was last seen, when visible.').nullable().optional(),
    lastDesktopVersion: z.string().describe('The last Docker Desktop version seen for the member, when visible.').nullable().optional(),
  }).describe('A Docker Hub organization member.')).describe('The items in the current page.'),
}).describe('A paginated Docker Hub organization member list.')

export const addOrgMemberInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  invitee: z.string().min(1).describe('The Docker ID or email address to invite.'),
  teamName: z.string().min(1).describe('The optional team to attach to the invite.').optional(),
  role: z.string().describe('The optional organization role to assign to the invite.').optional(),
  dryRun: z.boolean().describe('Whether to validate the invite without creating it.').optional(),
}).describe('The input payload for this action.')

export const addOrgMemberOutput = z.strictObject({
  invitees: z.array(z.strictObject({
    invitee: z.string().describe('The invited Docker ID or email address.').nullable().optional(),
    status: z.string().describe('The invite creation result status.').nullable().optional(),
    invite: z.strictObject({
      id: z.string().describe('The invite identifier, when available.').nullable().optional(),
      inviterUsername: z.string().describe('The Docker Hub username that created the invite, when available.').nullable().optional(),
      invitee: z.string().describe('The invited Docker ID or email address.').nullable().optional(),
      org: z.string().describe('The organization that owns the invite.').nullable().optional(),
      team: z.string().describe('The team attached to the invite, when available.').nullable().optional(),
      createdAt: z.string().describe('The ISO 8601 timestamp when the invite was created, when available.').nullable().optional(),
    }).describe('A Docker Hub organization invite.').nullable().optional(),
  }).describe('A single Docker Hub bulk invite result.')).describe('The invite results returned by the bulk invite endpoint.'),
}).describe('The output payload for inviting a member to a Docker Hub organization.')

export const removeOrgMemberInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  username: z.string().min(1).describe('The Docker Hub username to remove.'),
}).describe('The input payload for this action.')

export const removeOrgMemberOutput = z.strictObject({
  removed: z.boolean().describe('Whether the member removal request completed.'),
}).describe('The output payload for this action.')

export const listOrgAccessTokensInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  page: z.int().min(1).describe('The page number to retrieve.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of results to return per page.').optional(),
}).describe('The input payload for this action.')

export const listOrgAccessTokensOutput = z.strictObject({
  total: z.int().describe('The total number of organization access tokens.'),
  next: z.string().describe('The URL for the next page, or null when unavailable.').nullable(),
  previous: z.string().describe('The URL for the previous page, or null when unavailable.').nullable(),
  results: z.array(z.strictObject({
    id: z.string().describe('The organization access token identifier.').nullable().optional(),
    label: z.string().describe('The organization access token label.').nullable().optional(),
    createdBy: z.string().describe('The username that created the token, when available.').nullable().optional(),
    isActive: z.boolean().describe('Whether the organization access token is active.').nullable().optional(),
    createdAt: z.string().describe('The ISO 8601 timestamp when the token was created.').nullable().optional(),
    expiresAt: z.string().describe('The ISO 8601 timestamp when the token expires, when available.').nullable().optional(),
    lastUsedAt: z.string().describe('The ISO 8601 timestamp when the token was last used, when available.').nullable().optional(),
    resources: z.array(z.strictObject({
      type: z.string().describe('The organization access token resource type.').nullable().optional(),
      path: z.string().describe('The resource path granted to the token.').nullable().optional(),
      scopes: z.array(z.string().min(1)).describe('The scopes granted for the resource.').optional(),
    }).describe('A Docker Hub organization access token resource grant.')).describe('The resource grants attached to the token.').optional(),
  }).describe('A Docker Hub organization access token.')).describe('The organization access tokens in the current page.'),
}).describe('A paginated Docker Hub organization access token list.')

export const listTeamsInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  page: z.int().min(1).describe('The page number to retrieve.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of results to return per page.').optional(),
  username: z.string().min(1).describe('An optional username to filter teams by membership.').optional(),
  search: z.string().min(1).describe('An optional team search term.').optional(),
}).describe('The input payload for this action.')

export const listTeamsOutput = z.strictObject({
  count: z.int().describe('The total number of matching items.'),
  next: z.string().describe('The URL for the next page, or null when unavailable.').nullable(),
  previous: z.string().describe('The URL for the previous page, or null when unavailable.').nullable(),
  results: z.array(z.strictObject({
    id: z.int().describe('The numeric team identifier, when available.').nullable().optional(),
    uuid: z.string().describe('The stable UUID of the team, when available.').nullable().optional(),
    name: z.string().describe('The team name.').nullable().optional(),
    description: z.string().describe('The team description, when available.').nullable().optional(),
    memberCount: z.int().describe('The number of members in the team.').nullable().optional(),
  }).describe('A Docker Hub organization team.')).describe('The items in the current page.'),
}).describe('A paginated Docker Hub team list.')

export const getTeamInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  teamName: z.string().min(1).describe('The team name.'),
}).describe('The input payload for this action.')

export const getTeamOutput = z.strictObject({
  team: z.strictObject({
    id: z.int().describe('The numeric team identifier, when available.').nullable().optional(),
    uuid: z.string().describe('The stable UUID of the team, when available.').nullable().optional(),
    name: z.string().describe('The team name.').nullable().optional(),
    description: z.string().describe('The team description, when available.').nullable().optional(),
    memberCount: z.int().describe('The number of members in the team.').nullable().optional(),
  }).describe('A Docker Hub organization team.'),
}).describe('The output payload for retrieving a Docker Hub team.')

export const deleteTeamInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  teamName: z.string().min(1).describe('The team name.'),
}).describe('The input payload for this action.')

export const deleteTeamOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the team deletion request completed.'),
}).describe('The output payload for this action.')

export const listTeamMembersInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  teamName: z.string().min(1).describe('The team name.'),
  page: z.int().min(1).describe('The page number to retrieve.').optional(),
  pageSize: z.int().min(1).max(100).describe('The number of results to return per page.').optional(),
  search: z.string().min(1).describe('An optional member search term.').optional(),
}).describe('The input payload for this action.')

export const listTeamMembersOutput = z.strictObject({
  count: z.int().describe('The total number of matching items.'),
  next: z.string().describe('The URL for the next page, or null when unavailable.').nullable(),
  previous: z.string().describe('The URL for the previous page, or null when unavailable.').nullable(),
  results: z.array(z.strictObject({
    id: z.string().describe('The member identifier, when available.').nullable().optional(),
    username: z.string().describe('The Docker Hub username of the team member.').nullable().optional(),
    fullName: z.string().describe('The full name of the team member, when available.').nullable().optional(),
    email: z.string().describe('The email address of the team member, when available.').nullable().optional(),
    company: z.string().describe('The company value returned for the member, when available.').nullable().optional(),
    location: z.string().describe('The location value returned for the member, when available.').nullable().optional(),
    profileUrl: z.string().describe('The profile URL returned for the member, when available.').nullable().optional(),
    type: z.string().describe('The Docker Hub member type, when available.').nullable().optional(),
    dateJoined: z.string().describe('The ISO 8601 timestamp when the member joined the team.').nullable().optional(),
  }).describe('A Docker Hub team member.')).describe('The items in the current page.'),
}).describe('A paginated Docker Hub team member list.')

export const removeTeamMemberInput = z.strictObject({
  orgName: z.string().min(1).describe('The Docker Hub organization name.'),
  teamName: z.string().min(1).describe('The team name.'),
  username: z.string().min(1).describe('The Docker Hub username to remove from the team.'),
}).describe('The input payload for this action.')

export const removeTeamMemberOutput = z.strictObject({
  removed: z.boolean().describe('Whether the team member removal request completed.'),
}).describe('The output payload for this action.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const dockerHubActions = {
  list_repositories: {
    description: 'List Docker Hub repositories in a namespace with optional name filtering and ordering.',
    effect: 'read',
    inputSchema: listRepositoriesInput,
    outputSchema: z.toJSONSchema(listRepositoriesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_repository: {
    description: 'Get detailed metadata for a Docker Hub repository within a namespace.',
    effect: 'read',
    inputSchema: getRepositoryInput,
    outputSchema: z.toJSONSchema(getRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_repository: {
    description: 'Create a Docker Hub repository inside a namespace.',
    effect: 'write',
    inputSchema: createRepositoryInput,
    outputSchema: z.toJSONSchema(createRepositoryOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_tag: {
    description: 'Get metadata and image variants for a specific Docker Hub repository tag.',
    effect: 'read',
    inputSchema: getTagInput,
    outputSchema: z.toJSONSchema(getTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_image: {
    description: 'Find a Docker Hub image variant by digest by scanning the repository\'s published tags.',
    effect: 'read',
    inputSchema: getImageInput,
    outputSchema: z.toJSONSchema(getImageOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_org_members: {
    description: 'List Docker Hub organization members with optional filtering and pagination.',
    effect: 'read',
    inputSchema: listOrgMembersInput,
    outputSchema: z.toJSONSchema(listOrgMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  add_org_member: {
    description: 'Invite a Docker ID or email address to join a Docker Hub organization.',
    effect: 'write',
    inputSchema: addOrgMemberInput,
    outputSchema: z.toJSONSchema(addOrgMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_org_member: {
    description: 'Remove a member from a Docker Hub organization.',
    effect: 'destructive',
    inputSchema: removeOrgMemberInput,
    outputSchema: z.toJSONSchema(removeOrgMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_org_access_tokens: {
    description: 'List Docker Hub organization access tokens for an organization.',
    effect: 'read',
    inputSchema: listOrgAccessTokensInput,
    outputSchema: z.toJSONSchema(listOrgAccessTokensOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_teams: {
    description: 'List Docker Hub teams for an organization.',
    effect: 'read',
    inputSchema: listTeamsInput,
    outputSchema: z.toJSONSchema(listTeamsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_team: {
    description: 'Get a Docker Hub team within an organization.',
    effect: 'read',
    inputSchema: getTeamInput,
    outputSchema: z.toJSONSchema(getTeamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_team: {
    description: 'Delete a Docker Hub team within an organization.',
    effect: 'destructive',
    inputSchema: deleteTeamInput,
    outputSchema: z.toJSONSchema(deleteTeamOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_team_members: {
    description: 'List members of a Docker Hub team within an organization.',
    effect: 'read',
    inputSchema: listTeamMembersInput,
    outputSchema: z.toJSONSchema(listTeamMembersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  remove_team_member: {
    description: 'Remove a user from a Docker Hub team within an organization.',
    effect: 'destructive',
    inputSchema: removeTeamMemberInput,
    outputSchema: z.toJSONSchema(removeTeamMemberOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
