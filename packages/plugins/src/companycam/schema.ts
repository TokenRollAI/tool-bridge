/**
 * CompanyCam 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getCompanyInput = z.strictObject({}).describe('The input payload for retrieving the CompanyCam company.')

export const getCompanyOutput = z.strictObject({
  company: z.strictObject({
    id: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    name: z.string().describe('The company name.').nullable().optional(),
    status: z.string().describe('The company status returned by CompanyCam.').nullable().optional(),
    address: z.strictObject({
      streetAddress1: z.string().describe('The first street address line.').nullable().optional(),
      streetAddress2: z.string().describe('The second street address line.').nullable().optional(),
      city: z.string().describe('The city name.').nullable().optional(),
      state: z.string().describe('The state or region name.').nullable().optional(),
      postalCode: z.string().describe('The postal or ZIP code.').nullable().optional(),
      country: z.string().describe('The country code or name.').nullable().optional(),
    }).describe('A CompanyCam address.').nullable().optional(),
    logo: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The company logo variants.').optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam company.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when retrieving the CompanyCam company.')

export const getCurrentUserInput = z.strictObject({}).describe('The input payload for retrieving the current CompanyCam user.')

export const getCurrentUserOutput = z.strictObject({
  user: z.strictObject({
    id: z.string().describe('The CompanyCam user ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    emailAddress: z.string().describe('The user\'s email address.').nullable().optional(),
    status: z.string().describe('The user status returned by CompanyCam.').nullable().optional(),
    firstName: z.string().describe('The user\'s first name.').nullable().optional(),
    lastName: z.string().describe('The user\'s last name.').nullable().optional(),
    profileImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The user\'s profile image variants.').optional(),
    phoneNumber: z.string().describe('The user\'s phone number.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the user was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the user was updated.').nullable().optional(),
    userUrl: z.string().describe('The user URL in the CompanyCam web app.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam user.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when retrieving the current CompanyCam user.')

export const listProjectsInput = z.strictObject({
  page: z.int().min(1).describe('The page number to return.').optional(),
  perPage: z.int().min(1).describe('The number of records to return per page.').optional(),
  query: z.string().describe('Filter projects by name or the first address line.').optional(),
  modifiedSince: z.iso.datetime({ offset: true }).describe('Return projects modified on or after this timestamp.').optional(),
}).describe('The input payload for listing CompanyCam projects.')

export const listProjectsOutput = z.strictObject({
  projects: z.array(z.strictObject({
    id: z.string().describe('The CompanyCam project ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    creatorId: z.string().describe('The ID of the entity that created the project.').nullable().optional(),
    creatorType: z.string().describe('The type of entity that created the project.').nullable().optional(),
    creatorName: z.string().describe('The display name of the entity that created the project.').nullable().optional(),
    status: z.string().describe('The project status returned by CompanyCam.').nullable().optional(),
    archived: z.boolean().describe('Whether the project is archived.').nullable().optional(),
    name: z.string().describe('The project name.').nullable().optional(),
    address: z.strictObject({
      streetAddress1: z.string().describe('The first street address line.').nullable().optional(),
      streetAddress2: z.string().describe('The second street address line.').nullable().optional(),
      city: z.string().describe('The city name.').nullable().optional(),
      state: z.string().describe('The state or region name.').nullable().optional(),
      postalCode: z.string().describe('The postal or ZIP code.').nullable().optional(),
      country: z.string().describe('The country code or name.').nullable().optional(),
    }).describe('A CompanyCam address.').nullable().optional(),
    coordinates: z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.').nullable().optional(),
    featuredImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The project feature image variants.').optional(),
    projectUrl: z.string().describe('The project URL in the CompanyCam web app.').nullable().optional(),
    embeddedProjectUrl: z.string().describe('The embeddable project URL.').nullable().optional(),
    slug: z.string().describe('The public slug used in some CompanyCam URLs.').nullable().optional(),
    public: z.boolean().describe('Whether the project timeline and public features are enabled.').nullable().optional(),
    geofence: z.array(z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.')).describe('The project geofence coordinates.').optional(),
    notepad: z.string().describe('The project notepad text.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the project was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the project was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam project.')).describe('The CompanyCam projects returned by the API.').optional(),
  raw: z.array(z.looseObject({}).describe('The raw CompanyCam object.')).describe('The raw CompanyCam project array.').optional(),
}).describe('The response returned when listing CompanyCam projects.')

export const getProjectInput = z.strictObject({
  projectId: z.string().min(1).describe('The CompanyCam project ID.').optional(),
}).describe('The input payload for retrieving one CompanyCam project.')

export const getProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('The CompanyCam project ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    creatorId: z.string().describe('The ID of the entity that created the project.').nullable().optional(),
    creatorType: z.string().describe('The type of entity that created the project.').nullable().optional(),
    creatorName: z.string().describe('The display name of the entity that created the project.').nullable().optional(),
    status: z.string().describe('The project status returned by CompanyCam.').nullable().optional(),
    archived: z.boolean().describe('Whether the project is archived.').nullable().optional(),
    name: z.string().describe('The project name.').nullable().optional(),
    address: z.strictObject({
      streetAddress1: z.string().describe('The first street address line.').nullable().optional(),
      streetAddress2: z.string().describe('The second street address line.').nullable().optional(),
      city: z.string().describe('The city name.').nullable().optional(),
      state: z.string().describe('The state or region name.').nullable().optional(),
      postalCode: z.string().describe('The postal or ZIP code.').nullable().optional(),
      country: z.string().describe('The country code or name.').nullable().optional(),
    }).describe('A CompanyCam address.').nullable().optional(),
    coordinates: z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.').nullable().optional(),
    featuredImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The project feature image variants.').optional(),
    projectUrl: z.string().describe('The project URL in the CompanyCam web app.').nullable().optional(),
    embeddedProjectUrl: z.string().describe('The embeddable project URL.').nullable().optional(),
    slug: z.string().describe('The public slug used in some CompanyCam URLs.').nullable().optional(),
    public: z.boolean().describe('Whether the project timeline and public features are enabled.').nullable().optional(),
    geofence: z.array(z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.')).describe('The project geofence coordinates.').optional(),
    notepad: z.string().describe('The project notepad text.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the project was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the project was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam project.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when retrieving one CompanyCam project.')

export const createProjectInput = z.strictObject({
  name: z.string().min(1).describe('The project name.'),
  address: z.strictObject({
    streetAddress1: z.string().describe('The first street address line.').optional(),
    streetAddress2: z.string().describe('The second street address line.').optional(),
    city: z.string().describe('The city name.').optional(),
    state: z.string().describe('The state or region name.').optional(),
    postalCode: z.string().describe('The postal or ZIP code.').optional(),
    country: z.string().describe('The country code or name.').optional(),
  }).describe('The address fields to send to CompanyCam.').optional(),
  coordinates: z.strictObject({
    lat: z.number().describe('The latitude value.').optional(),
    lon: z.number().describe('The longitude value.').optional(),
  }).describe('A latitude and longitude coordinate.').optional(),
  geofence: z.array(z.strictObject({
    lat: z.number().describe('The latitude value.').optional(),
    lon: z.number().describe('The longitude value.').optional(),
  }).describe('A latitude and longitude coordinate.')).min(1).describe('The project geofence coordinates.').optional(),
  primaryContact: z.strictObject({
    name: z.string().describe('The primary contact name.').optional(),
    email: z.email().describe('The primary contact email address.').optional(),
    phoneNumber: z.string().describe('The primary contact phone number.').optional(),
  }).describe('The primary contact fields to send to CompanyCam.').optional(),
  currentUserEmail: z.email().describe('The CompanyCam user email to send in the X-CompanyCam-User header.').optional(),
}).describe('The input payload for creating a CompanyCam project.')

export const createProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('The CompanyCam project ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    creatorId: z.string().describe('The ID of the entity that created the project.').nullable().optional(),
    creatorType: z.string().describe('The type of entity that created the project.').nullable().optional(),
    creatorName: z.string().describe('The display name of the entity that created the project.').nullable().optional(),
    status: z.string().describe('The project status returned by CompanyCam.').nullable().optional(),
    archived: z.boolean().describe('Whether the project is archived.').nullable().optional(),
    name: z.string().describe('The project name.').nullable().optional(),
    address: z.strictObject({
      streetAddress1: z.string().describe('The first street address line.').nullable().optional(),
      streetAddress2: z.string().describe('The second street address line.').nullable().optional(),
      city: z.string().describe('The city name.').nullable().optional(),
      state: z.string().describe('The state or region name.').nullable().optional(),
      postalCode: z.string().describe('The postal or ZIP code.').nullable().optional(),
      country: z.string().describe('The country code or name.').nullable().optional(),
    }).describe('A CompanyCam address.').nullable().optional(),
    coordinates: z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.').nullable().optional(),
    featuredImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The project feature image variants.').optional(),
    projectUrl: z.string().describe('The project URL in the CompanyCam web app.').nullable().optional(),
    embeddedProjectUrl: z.string().describe('The embeddable project URL.').nullable().optional(),
    slug: z.string().describe('The public slug used in some CompanyCam URLs.').nullable().optional(),
    public: z.boolean().describe('Whether the project timeline and public features are enabled.').nullable().optional(),
    geofence: z.array(z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.')).describe('The project geofence coordinates.').optional(),
    notepad: z.string().describe('The project notepad text.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the project was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the project was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam project.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when creating a CompanyCam project.')

export const updateProjectInput = z.strictObject({
  projectId: z.string().min(1).describe('The CompanyCam project ID.'),
  name: z.string().describe('The updated project name.').optional(),
  address: z.strictObject({
    streetAddress1: z.string().describe('The first street address line.').optional(),
    streetAddress2: z.string().describe('The second street address line.').optional(),
    city: z.string().describe('The city name.').optional(),
    state: z.string().describe('The state or region name.').optional(),
    postalCode: z.string().describe('The postal or ZIP code.').optional(),
    country: z.string().describe('The country code or name.').optional(),
  }).describe('The address fields to send to CompanyCam.').optional(),
  coordinates: z.strictObject({
    lat: z.number().describe('The latitude value.').optional(),
    lon: z.number().describe('The longitude value.').optional(),
  }).describe('A latitude and longitude coordinate.').optional(),
  geofence: z.array(z.strictObject({
    lat: z.number().describe('The latitude value.').optional(),
    lon: z.number().describe('The longitude value.').optional(),
  }).describe('A latitude and longitude coordinate.')).min(1).describe('The updated project geofence coordinates.').optional(),
}).describe('The input payload for updating a CompanyCam project.')

export const updateProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('The CompanyCam project ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    creatorId: z.string().describe('The ID of the entity that created the project.').nullable().optional(),
    creatorType: z.string().describe('The type of entity that created the project.').nullable().optional(),
    creatorName: z.string().describe('The display name of the entity that created the project.').nullable().optional(),
    status: z.string().describe('The project status returned by CompanyCam.').nullable().optional(),
    archived: z.boolean().describe('Whether the project is archived.').nullable().optional(),
    name: z.string().describe('The project name.').nullable().optional(),
    address: z.strictObject({
      streetAddress1: z.string().describe('The first street address line.').nullable().optional(),
      streetAddress2: z.string().describe('The second street address line.').nullable().optional(),
      city: z.string().describe('The city name.').nullable().optional(),
      state: z.string().describe('The state or region name.').nullable().optional(),
      postalCode: z.string().describe('The postal or ZIP code.').nullable().optional(),
      country: z.string().describe('The country code or name.').nullable().optional(),
    }).describe('A CompanyCam address.').nullable().optional(),
    coordinates: z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.').nullable().optional(),
    featuredImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The project feature image variants.').optional(),
    projectUrl: z.string().describe('The project URL in the CompanyCam web app.').nullable().optional(),
    embeddedProjectUrl: z.string().describe('The embeddable project URL.').nullable().optional(),
    slug: z.string().describe('The public slug used in some CompanyCam URLs.').nullable().optional(),
    public: z.boolean().describe('Whether the project timeline and public features are enabled.').nullable().optional(),
    geofence: z.array(z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.')).describe('The project geofence coordinates.').optional(),
    notepad: z.string().describe('The project notepad text.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the project was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the project was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam project.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when updating a CompanyCam project.')

export const archiveProjectInput = z.strictObject({
  projectId: z.string().min(1).describe('The CompanyCam project ID.').optional(),
}).describe('The input payload for archiving a CompanyCam project.')

export const archiveProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('The CompanyCam project ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    creatorId: z.string().describe('The ID of the entity that created the project.').nullable().optional(),
    creatorType: z.string().describe('The type of entity that created the project.').nullable().optional(),
    creatorName: z.string().describe('The display name of the entity that created the project.').nullable().optional(),
    status: z.string().describe('The project status returned by CompanyCam.').nullable().optional(),
    archived: z.boolean().describe('Whether the project is archived.').nullable().optional(),
    name: z.string().describe('The project name.').nullable().optional(),
    address: z.strictObject({
      streetAddress1: z.string().describe('The first street address line.').nullable().optional(),
      streetAddress2: z.string().describe('The second street address line.').nullable().optional(),
      city: z.string().describe('The city name.').nullable().optional(),
      state: z.string().describe('The state or region name.').nullable().optional(),
      postalCode: z.string().describe('The postal or ZIP code.').nullable().optional(),
      country: z.string().describe('The country code or name.').nullable().optional(),
    }).describe('A CompanyCam address.').nullable().optional(),
    coordinates: z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.').nullable().optional(),
    featuredImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The project feature image variants.').optional(),
    projectUrl: z.string().describe('The project URL in the CompanyCam web app.').nullable().optional(),
    embeddedProjectUrl: z.string().describe('The embeddable project URL.').nullable().optional(),
    slug: z.string().describe('The public slug used in some CompanyCam URLs.').nullable().optional(),
    public: z.boolean().describe('Whether the project timeline and public features are enabled.').nullable().optional(),
    geofence: z.array(z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.')).describe('The project geofence coordinates.').optional(),
    notepad: z.string().describe('The project notepad text.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the project was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the project was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam project.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when archiving a CompanyCam project.')

export const restoreProjectInput = z.strictObject({
  projectId: z.string().min(1).describe('The CompanyCam project ID.').optional(),
}).describe('The input payload for restoring a CompanyCam project.')

export const restoreProjectOutput = z.strictObject({
  project: z.strictObject({
    id: z.string().describe('The CompanyCam project ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    creatorId: z.string().describe('The ID of the entity that created the project.').nullable().optional(),
    creatorType: z.string().describe('The type of entity that created the project.').nullable().optional(),
    creatorName: z.string().describe('The display name of the entity that created the project.').nullable().optional(),
    status: z.string().describe('The project status returned by CompanyCam.').nullable().optional(),
    archived: z.boolean().describe('Whether the project is archived.').nullable().optional(),
    name: z.string().describe('The project name.').nullable().optional(),
    address: z.strictObject({
      streetAddress1: z.string().describe('The first street address line.').nullable().optional(),
      streetAddress2: z.string().describe('The second street address line.').nullable().optional(),
      city: z.string().describe('The city name.').nullable().optional(),
      state: z.string().describe('The state or region name.').nullable().optional(),
      postalCode: z.string().describe('The postal or ZIP code.').nullable().optional(),
      country: z.string().describe('The country code or name.').nullable().optional(),
    }).describe('A CompanyCam address.').nullable().optional(),
    coordinates: z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.').nullable().optional(),
    featuredImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The project feature image variants.').optional(),
    projectUrl: z.string().describe('The project URL in the CompanyCam web app.').nullable().optional(),
    embeddedProjectUrl: z.string().describe('The embeddable project URL.').nullable().optional(),
    slug: z.string().describe('The public slug used in some CompanyCam URLs.').nullable().optional(),
    public: z.boolean().describe('Whether the project timeline and public features are enabled.').nullable().optional(),
    geofence: z.array(z.strictObject({
      lat: z.number().describe('The latitude value.').optional(),
      lon: z.number().describe('The longitude value.').optional(),
    }).describe('A latitude and longitude coordinate.')).describe('The project geofence coordinates.').optional(),
    notepad: z.string().describe('The project notepad text.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the project was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the project was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam project.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when restoring a CompanyCam project.')

export const listUsersInput = z.strictObject({
  page: z.int().min(1).describe('The page number to return.').optional(),
  perPage: z.int().min(1).describe('The number of records to return per page.').optional(),
}).describe('The input payload for listing CompanyCam users.')

export const listUsersOutput = z.strictObject({
  users: z.array(z.strictObject({
    id: z.string().describe('The CompanyCam user ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    emailAddress: z.string().describe('The user\'s email address.').nullable().optional(),
    status: z.string().describe('The user status returned by CompanyCam.').nullable().optional(),
    firstName: z.string().describe('The user\'s first name.').nullable().optional(),
    lastName: z.string().describe('The user\'s last name.').nullable().optional(),
    profileImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The user\'s profile image variants.').optional(),
    phoneNumber: z.string().describe('The user\'s phone number.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the user was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the user was updated.').nullable().optional(),
    userUrl: z.string().describe('The user URL in the CompanyCam web app.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam user.')).describe('The CompanyCam users returned by the API.').optional(),
  raw: z.array(z.looseObject({}).describe('The raw CompanyCam object.')).describe('The raw CompanyCam user array.').optional(),
}).describe('The response returned when listing CompanyCam users.')

export const getUserInput = z.strictObject({
  userId: z.string().min(1).describe('The CompanyCam user ID.').optional(),
}).describe('The input payload for retrieving one CompanyCam user.')

export const getUserOutput = z.strictObject({
  user: z.strictObject({
    id: z.string().describe('The CompanyCam user ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    emailAddress: z.string().describe('The user\'s email address.').nullable().optional(),
    status: z.string().describe('The user status returned by CompanyCam.').nullable().optional(),
    firstName: z.string().describe('The user\'s first name.').nullable().optional(),
    lastName: z.string().describe('The user\'s last name.').nullable().optional(),
    profileImage: z.array(z.strictObject({
      type: z.string().describe('The image variant type.').nullable().optional(),
      uri: z.string().describe('The image URI.').nullable().optional(),
      url: z.string().describe('The image URL.').nullable().optional(),
    }).describe('A CompanyCam image URI variant.')).describe('The user\'s profile image variants.').optional(),
    phoneNumber: z.string().describe('The user\'s phone number.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the user was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the user was updated.').nullable().optional(),
    userUrl: z.string().describe('The user URL in the CompanyCam web app.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam user.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when retrieving one CompanyCam user.')

export const listTagsInput = z.strictObject({
  page: z.int().min(1).describe('The page number to return.').optional(),
  perPage: z.int().min(1).describe('The number of records to return per page.').optional(),
}).describe('The input payload for listing CompanyCam tags.')

export const listTagsOutput = z.strictObject({
  tags: z.array(z.strictObject({
    id: z.string().describe('The CompanyCam tag ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    displayValue: z.string().describe('The user-facing tag label.').nullable().optional(),
    value: z.string().describe('The normalized tag value used for searching and sorting.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the tag was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the tag was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam tag.')).describe('The CompanyCam tags returned by the API.').optional(),
  raw: z.array(z.looseObject({}).describe('The raw CompanyCam object.')).describe('The raw CompanyCam tag array.').optional(),
}).describe('The response returned when listing CompanyCam tags.')

export const getTagInput = z.strictObject({
  tagId: z.string().min(1).describe('The CompanyCam tag ID.').optional(),
}).describe('The input payload for retrieving one CompanyCam tag.')

export const getTagOutput = z.strictObject({
  tag: z.strictObject({
    id: z.string().describe('The CompanyCam tag ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    displayValue: z.string().describe('The user-facing tag label.').nullable().optional(),
    value: z.string().describe('The normalized tag value used for searching and sorting.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the tag was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the tag was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam tag.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when retrieving one CompanyCam tag.')

export const createTagInput = z.strictObject({
  displayValue: z.string().min(1).describe('The user-facing tag label.').optional(),
}).describe('The input payload for creating a CompanyCam tag.')

export const createTagOutput = z.strictObject({
  tag: z.strictObject({
    id: z.string().describe('The CompanyCam tag ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    displayValue: z.string().describe('The user-facing tag label.').nullable().optional(),
    value: z.string().describe('The normalized tag value used for searching and sorting.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the tag was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the tag was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam tag.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when creating a CompanyCam tag.')

export const updateTagInput = z.strictObject({
  tagId: z.string().min(1).describe('The CompanyCam tag ID.').optional(),
  displayValue: z.string().min(1).describe('The updated user-facing tag label.').optional(),
}).describe('The input payload for updating a CompanyCam tag.')

export const updateTagOutput = z.strictObject({
  tag: z.strictObject({
    id: z.string().describe('The CompanyCam tag ID.').nullable().optional(),
    companyId: z.string().describe('The CompanyCam company ID.').nullable().optional(),
    displayValue: z.string().describe('The user-facing tag label.').nullable().optional(),
    value: z.string().describe('The normalized tag value used for searching and sorting.').nullable().optional(),
    createdAt: z.int().describe('The Unix timestamp when the tag was created.').nullable().optional(),
    updatedAt: z.int().describe('The Unix timestamp when the tag was updated.').nullable().optional(),
    raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
  }).describe('A CompanyCam tag.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when updating a CompanyCam tag.')

export const deleteTagInput = z.strictObject({
  tagId: z.string().min(1).describe('The CompanyCam tag ID.').optional(),
}).describe('The input payload for deleting a CompanyCam tag.')

export const deleteTagOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the delete request completed successfully.').optional(),
  raw: z.looseObject({}).describe('The raw CompanyCam object.').optional(),
}).describe('The response returned when deleting a CompanyCam tag.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const companycamActions = {
  get_company: {
    description: 'Retrieve the CompanyCam company associated with the API token.',
    effect: 'read',
    inputSchema: getCompanyInput,
    outputSchema: z.toJSONSchema(getCompanyOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_current_user: {
    description: 'Retrieve the current CompanyCam user associated with the API token.',
    effect: 'read',
    inputSchema: getCurrentUserInput,
    outputSchema: z.toJSONSchema(getCurrentUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_projects: {
    description: 'List CompanyCam projects with optional name, address, and modified-since filters.',
    effect: 'read',
    inputSchema: listProjectsInput,
    outputSchema: z.toJSONSchema(listProjectsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_project: {
    description: 'Retrieve one CompanyCam project by ID.',
    effect: 'read',
    inputSchema: getProjectInput,
    outputSchema: z.toJSONSchema(getProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_project: {
    description: 'Create a CompanyCam project with optional address, coordinates, and contact data.',
    effect: 'write',
    inputSchema: createProjectInput,
    outputSchema: z.toJSONSchema(createProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_project: {
    description: 'Update a CompanyCam project\'s name, address, coordinates, or geofence.',
    effect: 'write',
    inputSchema: updateProjectInput,
    outputSchema: z.toJSONSchema(updateProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  archive_project: {
    description: 'Archive a CompanyCam project by ID.',
    effect: 'write',
    inputSchema: archiveProjectInput,
    outputSchema: z.toJSONSchema(archiveProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  restore_project: {
    description: 'Restore an archived CompanyCam project by ID.',
    effect: 'write',
    inputSchema: restoreProjectInput,
    outputSchema: z.toJSONSchema(restoreProjectOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_users: {
    description: 'List CompanyCam users visible to the API token.',
    effect: 'read',
    inputSchema: listUsersInput,
    outputSchema: z.toJSONSchema(listUsersOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_user: {
    description: 'Retrieve one CompanyCam user by ID.',
    effect: 'read',
    inputSchema: getUserInput,
    outputSchema: z.toJSONSchema(getUserOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_tags: {
    description: 'List CompanyCam tags visible to the API token.',
    effect: 'read',
    inputSchema: listTagsInput,
    outputSchema: z.toJSONSchema(listTagsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_tag: {
    description: 'Retrieve one CompanyCam tag by ID.',
    effect: 'read',
    inputSchema: getTagInput,
    outputSchema: z.toJSONSchema(getTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_tag: {
    description: 'Create a CompanyCam tag.',
    effect: 'write',
    inputSchema: createTagInput,
    outputSchema: z.toJSONSchema(createTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_tag: {
    description: 'Update a CompanyCam tag label.',
    effect: 'write',
    inputSchema: updateTagInput,
    outputSchema: z.toJSONSchema(updateTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_tag: {
    description: 'Delete a CompanyCam tag by ID.',
    effect: 'destructive',
    inputSchema: deleteTagInput,
    outputSchema: z.toJSONSchema(deleteTagOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
