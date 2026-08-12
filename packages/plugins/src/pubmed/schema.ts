/**
 * PubMed 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const searchArticlesInput = z.strictObject({
  query: z.string().min(1).describe('The PubMed query, including optional official field tags and Boolean operators such as cancer[Title] AND 2025[pdat].'),
  offset: z.int().min(0).max(9999).default(0).describe('The zero-based search result offset.').optional(),
  limit: z.int().min(1).max(50).default(10).describe('The maximum number of articles to return.').optional(),
  sort: z.enum(['relevance', 'publication_date', 'first_author', 'journal']).describe('The PubMed result sort order.').optional(),
  publicationDateRange: z.strictObject({
    from: z.iso.date().describe('The earliest publication date to include.').optional(),
    to: z.iso.date().describe('The latest publication date to include.').optional(),
  }).describe('An inclusive PubMed publication date range.').optional(),
}).describe('Input parameters for searching PubMed articles.')

export const searchArticlesOutput = z.strictObject({
  total: z.int().min(0).describe('The total number of matching PubMed records.').optional(),
  offset: z.int().min(0).describe('The zero-based result offset.').optional(),
  limit: z.int().min(1).describe('The requested page size.').optional(),
  queryTranslation: z.string().describe('The query translation reported by PubMed.').nullable().optional(),
  articles: z.array(z.strictObject({
    pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
    title: z.string().describe('The article title.').optional(),
    abstract: z.array(z.strictObject({
      label: z.string().describe('The structured abstract section label when present.').nullable().optional(),
      text: z.string().describe('The normalized abstract section text.').optional(),
    }).describe('One section of a PubMed abstract.')).describe('The structured or unstructured abstract sections.').optional(),
    authors: z.array(z.strictObject({
      name: z.string().describe('The author or collective author name.').optional(),
      orcid: z.string().describe('The author\'s ORCID when present.').nullable().optional(),
      affiliations: z.array(z.string().describe('One affiliation.')).describe('The author\'s affiliations.').optional(),
    }).describe('A normalized PubMed author or author group.')).describe('The article authors.').optional(),
    journal: z.strictObject({
      title: z.string().describe('The full journal title.').nullable().optional(),
      abbreviation: z.string().describe('The NLM journal abbreviation.').nullable().optional(),
      issn: z.string().describe('The journal ISSN returned by PubMed.').nullable().optional(),
      volume: z.string().describe('The journal volume.').nullable().optional(),
      issue: z.string().describe('The journal issue.').nullable().optional(),
    }).describe('The journal information attached to a PubMed record.').optional(),
    publicationDate: z.string().describe('The publication date or source Medline date.').nullable().optional(),
    publicationTypes: z.array(z.string().describe('One publication type.')).describe('The PubMed publication types.').optional(),
    meshTerms: z.array(z.string().describe('One MeSH descriptor.')).describe('The assigned Medical Subject Headings.').optional(),
    keywords: z.array(z.string().describe('One keyword.')).describe('The keywords attached to the PubMed record.').optional(),
    languages: z.array(z.string().describe('One language code.')).describe('The article language codes returned by PubMed.').optional(),
    doi: z.string().describe('The article DOI when present.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when present.').nullable().optional(),
    pubmedUrl: z.url().describe('The canonical PubMed record URL.').optional(),
    pmcUrl: z.url().describe('The PubMed Central article URL when available.').nullable().optional(),
  }).describe('A normalized PubMed article record.')).describe('The normalized articles in this page.').optional(),
}).describe('A page of normalized PubMed search results.')

export const matchCitationInput = z.strictObject({
  citation: z.string().min(1).describe('The citation text to match, such as an article title followed by its journal, year, volume, and pages.').optional(),
}).describe('Input parameters for matching one citation.')

export const matchCitationOutput = z.strictObject({
  matched: z.boolean().describe('Whether PubMed returned at least one candidate article.').optional(),
  articles: z.array(z.strictObject({
    pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
    title: z.string().describe('The article title.').optional(),
    abstract: z.array(z.strictObject({
      label: z.string().describe('The structured abstract section label when present.').nullable().optional(),
      text: z.string().describe('The normalized abstract section text.').optional(),
    }).describe('One section of a PubMed abstract.')).describe('The structured or unstructured abstract sections.').optional(),
    authors: z.array(z.strictObject({
      name: z.string().describe('The author or collective author name.').optional(),
      orcid: z.string().describe('The author\'s ORCID when present.').nullable().optional(),
      affiliations: z.array(z.string().describe('One affiliation.')).describe('The author\'s affiliations.').optional(),
    }).describe('A normalized PubMed author or author group.')).describe('The article authors.').optional(),
    journal: z.strictObject({
      title: z.string().describe('The full journal title.').nullable().optional(),
      abbreviation: z.string().describe('The NLM journal abbreviation.').nullable().optional(),
      issn: z.string().describe('The journal ISSN returned by PubMed.').nullable().optional(),
      volume: z.string().describe('The journal volume.').nullable().optional(),
      issue: z.string().describe('The journal issue.').nullable().optional(),
    }).describe('The journal information attached to a PubMed record.').optional(),
    publicationDate: z.string().describe('The publication date or source Medline date.').nullable().optional(),
    publicationTypes: z.array(z.string().describe('One publication type.')).describe('The PubMed publication types.').optional(),
    meshTerms: z.array(z.string().describe('One MeSH descriptor.')).describe('The assigned Medical Subject Headings.').optional(),
    keywords: z.array(z.string().describe('One keyword.')).describe('The keywords attached to the PubMed record.').optional(),
    languages: z.array(z.string().describe('One language code.')).describe('The article language codes returned by PubMed.').optional(),
    doi: z.string().describe('The article DOI when present.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when present.').nullable().optional(),
    pubmedUrl: z.url().describe('The canonical PubMed record URL.').optional(),
    pmcUrl: z.url().describe('The PubMed Central article URL when available.').nullable().optional(),
  }).describe('A normalized PubMed article record.')).describe('The normalized candidate articles returned by PubMed.').optional(),
}).describe('The PubMed articles matched from the citation text.')

export const getArticleInput = z.strictObject({
  pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
}).describe('Input parameters for getting one PubMed article.')

export const getArticleOutput = z.strictObject({
  found: z.boolean().describe('Whether PubMed returned the requested record.').optional(),
  article: z.strictObject({
    pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
    title: z.string().describe('The article title.').optional(),
    abstract: z.array(z.strictObject({
      label: z.string().describe('The structured abstract section label when present.').nullable().optional(),
      text: z.string().describe('The normalized abstract section text.').optional(),
    }).describe('One section of a PubMed abstract.')).describe('The structured or unstructured abstract sections.').optional(),
    authors: z.array(z.strictObject({
      name: z.string().describe('The author or collective author name.').optional(),
      orcid: z.string().describe('The author\'s ORCID when present.').nullable().optional(),
      affiliations: z.array(z.string().describe('One affiliation.')).describe('The author\'s affiliations.').optional(),
    }).describe('A normalized PubMed author or author group.')).describe('The article authors.').optional(),
    journal: z.strictObject({
      title: z.string().describe('The full journal title.').nullable().optional(),
      abbreviation: z.string().describe('The NLM journal abbreviation.').nullable().optional(),
      issn: z.string().describe('The journal ISSN returned by PubMed.').nullable().optional(),
      volume: z.string().describe('The journal volume.').nullable().optional(),
      issue: z.string().describe('The journal issue.').nullable().optional(),
    }).describe('The journal information attached to a PubMed record.').optional(),
    publicationDate: z.string().describe('The publication date or source Medline date.').nullable().optional(),
    publicationTypes: z.array(z.string().describe('One publication type.')).describe('The PubMed publication types.').optional(),
    meshTerms: z.array(z.string().describe('One MeSH descriptor.')).describe('The assigned Medical Subject Headings.').optional(),
    keywords: z.array(z.string().describe('One keyword.')).describe('The keywords attached to the PubMed record.').optional(),
    languages: z.array(z.string().describe('One language code.')).describe('The article language codes returned by PubMed.').optional(),
    doi: z.string().describe('The article DOI when present.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when present.').nullable().optional(),
    pubmedUrl: z.url().describe('The canonical PubMed record URL.').optional(),
    pmcUrl: z.url().describe('The PubMed Central article URL when available.').nullable().optional(),
  }).describe('A normalized PubMed article record.').nullable().optional(),
}).describe('The result of retrieving one PubMed article.')

export const getArticlesInput = z.strictObject({
  pmids: z.array(z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).')).min(1).max(50).describe('The PubMed identifiers to retrieve.').optional(),
}).describe('Input parameters for getting multiple PubMed articles.')

export const getArticlesOutput = z.strictObject({
  articles: z.array(z.strictObject({
    pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
    title: z.string().describe('The article title.').optional(),
    abstract: z.array(z.strictObject({
      label: z.string().describe('The structured abstract section label when present.').nullable().optional(),
      text: z.string().describe('The normalized abstract section text.').optional(),
    }).describe('One section of a PubMed abstract.')).describe('The structured or unstructured abstract sections.').optional(),
    authors: z.array(z.strictObject({
      name: z.string().describe('The author or collective author name.').optional(),
      orcid: z.string().describe('The author\'s ORCID when present.').nullable().optional(),
      affiliations: z.array(z.string().describe('One affiliation.')).describe('The author\'s affiliations.').optional(),
    }).describe('A normalized PubMed author or author group.')).describe('The article authors.').optional(),
    journal: z.strictObject({
      title: z.string().describe('The full journal title.').nullable().optional(),
      abbreviation: z.string().describe('The NLM journal abbreviation.').nullable().optional(),
      issn: z.string().describe('The journal ISSN returned by PubMed.').nullable().optional(),
      volume: z.string().describe('The journal volume.').nullable().optional(),
      issue: z.string().describe('The journal issue.').nullable().optional(),
    }).describe('The journal information attached to a PubMed record.').optional(),
    publicationDate: z.string().describe('The publication date or source Medline date.').nullable().optional(),
    publicationTypes: z.array(z.string().describe('One publication type.')).describe('The PubMed publication types.').optional(),
    meshTerms: z.array(z.string().describe('One MeSH descriptor.')).describe('The assigned Medical Subject Headings.').optional(),
    keywords: z.array(z.string().describe('One keyword.')).describe('The keywords attached to the PubMed record.').optional(),
    languages: z.array(z.string().describe('One language code.')).describe('The article language codes returned by PubMed.').optional(),
    doi: z.string().describe('The article DOI when present.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when present.').nullable().optional(),
    pubmedUrl: z.url().describe('The canonical PubMed record URL.').optional(),
    pmcUrl: z.url().describe('The PubMed Central article URL when available.').nullable().optional(),
  }).describe('A normalized PubMed article record.')).describe('The PubMed records that were found.').optional(),
  notFoundPmids: z.array(z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).')).describe('The requested PMIDs that PubMed did not return.').optional(),
}).describe('The result of retrieving multiple PubMed articles.')

export const findRelatedArticlesInput = z.strictObject({
  pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).'),
  limit: z.int().min(1).max(50).default(10).describe('The maximum number of articles to return.').optional(),
}).describe('Input parameters for finding related PubMed articles.')

export const findRelatedArticlesOutput = z.strictObject({
  sourcePmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
  articles: z.array(z.strictObject({
    pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
    title: z.string().describe('The article title.').optional(),
    abstract: z.array(z.strictObject({
      label: z.string().describe('The structured abstract section label when present.').nullable().optional(),
      text: z.string().describe('The normalized abstract section text.').optional(),
    }).describe('One section of a PubMed abstract.')).describe('The structured or unstructured abstract sections.').optional(),
    authors: z.array(z.strictObject({
      name: z.string().describe('The author or collective author name.').optional(),
      orcid: z.string().describe('The author\'s ORCID when present.').nullable().optional(),
      affiliations: z.array(z.string().describe('One affiliation.')).describe('The author\'s affiliations.').optional(),
    }).describe('A normalized PubMed author or author group.')).describe('The article authors.').optional(),
    journal: z.strictObject({
      title: z.string().describe('The full journal title.').nullable().optional(),
      abbreviation: z.string().describe('The NLM journal abbreviation.').nullable().optional(),
      issn: z.string().describe('The journal ISSN returned by PubMed.').nullable().optional(),
      volume: z.string().describe('The journal volume.').nullable().optional(),
      issue: z.string().describe('The journal issue.').nullable().optional(),
    }).describe('The journal information attached to a PubMed record.').optional(),
    publicationDate: z.string().describe('The publication date or source Medline date.').nullable().optional(),
    publicationTypes: z.array(z.string().describe('One publication type.')).describe('The PubMed publication types.').optional(),
    meshTerms: z.array(z.string().describe('One MeSH descriptor.')).describe('The assigned Medical Subject Headings.').optional(),
    keywords: z.array(z.string().describe('One keyword.')).describe('The keywords attached to the PubMed record.').optional(),
    languages: z.array(z.string().describe('One language code.')).describe('The article language codes returned by PubMed.').optional(),
    doi: z.string().describe('The article DOI when present.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when present.').nullable().optional(),
    pubmedUrl: z.url().describe('The canonical PubMed record URL.').optional(),
    pmcUrl: z.url().describe('The PubMed Central article URL when available.').nullable().optional(),
  }).describe('A normalized PubMed article record.')).describe('The normalized related PubMed articles.').optional(),
}).describe('The related PubMed articles returned for one source record.')

export const getCitingArticlesInput = z.strictObject({
  pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).'),
  limit: z.int().min(1).max(50).default(10).describe('The maximum number of articles to return.').optional(),
}).describe('Input parameters for getting articles that cite a source PubMed record.')

export const getCitingArticlesOutput = z.strictObject({
  sourcePmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
  articles: z.array(z.strictObject({
    pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
    title: z.string().describe('The article title.').optional(),
    abstract: z.array(z.strictObject({
      label: z.string().describe('The structured abstract section label when present.').nullable().optional(),
      text: z.string().describe('The normalized abstract section text.').optional(),
    }).describe('One section of a PubMed abstract.')).describe('The structured or unstructured abstract sections.').optional(),
    authors: z.array(z.strictObject({
      name: z.string().describe('The author or collective author name.').optional(),
      orcid: z.string().describe('The author\'s ORCID when present.').nullable().optional(),
      affiliations: z.array(z.string().describe('One affiliation.')).describe('The author\'s affiliations.').optional(),
    }).describe('A normalized PubMed author or author group.')).describe('The article authors.').optional(),
    journal: z.strictObject({
      title: z.string().describe('The full journal title.').nullable().optional(),
      abbreviation: z.string().describe('The NLM journal abbreviation.').nullable().optional(),
      issn: z.string().describe('The journal ISSN returned by PubMed.').nullable().optional(),
      volume: z.string().describe('The journal volume.').nullable().optional(),
      issue: z.string().describe('The journal issue.').nullable().optional(),
    }).describe('The journal information attached to a PubMed record.').optional(),
    publicationDate: z.string().describe('The publication date or source Medline date.').nullable().optional(),
    publicationTypes: z.array(z.string().describe('One publication type.')).describe('The PubMed publication types.').optional(),
    meshTerms: z.array(z.string().describe('One MeSH descriptor.')).describe('The assigned Medical Subject Headings.').optional(),
    keywords: z.array(z.string().describe('One keyword.')).describe('The keywords attached to the PubMed record.').optional(),
    languages: z.array(z.string().describe('One language code.')).describe('The article language codes returned by PubMed.').optional(),
    doi: z.string().describe('The article DOI when present.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when present.').nullable().optional(),
    pubmedUrl: z.url().describe('The canonical PubMed record URL.').optional(),
    pmcUrl: z.url().describe('The PubMed Central article URL when available.').nullable().optional(),
  }).describe('A normalized PubMed article record.')).describe('The normalized articles known to cite the source record.').optional(),
}).describe('The citing PubMed articles returned for one source record.')

export const getArticleReferencesInput = z.strictObject({
  pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).'),
  limit: z.int().min(1).max(50).default(10).describe('The maximum number of articles to return.').optional(),
}).describe('Input parameters for getting references from a source PubMed record.')

export const getArticleReferencesOutput = z.strictObject({
  sourcePmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
  articles: z.array(z.strictObject({
    pmid: z.string().min(1).regex(new RegExp('^[0-9]+$')).describe('The numeric PubMed identifier (PMID).').optional(),
    title: z.string().describe('The article title.').optional(),
    abstract: z.array(z.strictObject({
      label: z.string().describe('The structured abstract section label when present.').nullable().optional(),
      text: z.string().describe('The normalized abstract section text.').optional(),
    }).describe('One section of a PubMed abstract.')).describe('The structured or unstructured abstract sections.').optional(),
    authors: z.array(z.strictObject({
      name: z.string().describe('The author or collective author name.').optional(),
      orcid: z.string().describe('The author\'s ORCID when present.').nullable().optional(),
      affiliations: z.array(z.string().describe('One affiliation.')).describe('The author\'s affiliations.').optional(),
    }).describe('A normalized PubMed author or author group.')).describe('The article authors.').optional(),
    journal: z.strictObject({
      title: z.string().describe('The full journal title.').nullable().optional(),
      abbreviation: z.string().describe('The NLM journal abbreviation.').nullable().optional(),
      issn: z.string().describe('The journal ISSN returned by PubMed.').nullable().optional(),
      volume: z.string().describe('The journal volume.').nullable().optional(),
      issue: z.string().describe('The journal issue.').nullable().optional(),
    }).describe('The journal information attached to a PubMed record.').optional(),
    publicationDate: z.string().describe('The publication date or source Medline date.').nullable().optional(),
    publicationTypes: z.array(z.string().describe('One publication type.')).describe('The PubMed publication types.').optional(),
    meshTerms: z.array(z.string().describe('One MeSH descriptor.')).describe('The assigned Medical Subject Headings.').optional(),
    keywords: z.array(z.string().describe('One keyword.')).describe('The keywords attached to the PubMed record.').optional(),
    languages: z.array(z.string().describe('One language code.')).describe('The article language codes returned by PubMed.').optional(),
    doi: z.string().describe('The article DOI when present.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when present.').nullable().optional(),
    pubmedUrl: z.url().describe('The canonical PubMed record URL.').optional(),
    pmcUrl: z.url().describe('The PubMed Central article URL when available.').nullable().optional(),
  }).describe('A normalized PubMed article record.')).describe('The normalized PubMed articles referenced by the source record.').optional(),
}).describe('The PubMed references returned for one source record.')

export const convertArticleIdsInput = z.strictObject({
  ids: z.array(z.string().min(1).describe('One PMID, PMCID, DOI, or author manuscript identifier.')).min(1).max(200).describe('The article identifiers to convert. Every identifier must have the same idType.').optional(),
  idType: z.enum(['pmid', 'pmcid', 'doi', 'mid']).describe('The type shared by every input article identifier.').optional(),
}).describe('Input parameters for converting article identifiers.')

export const convertArticleIdsOutput = z.strictObject({
  records: z.array(z.strictObject({
    requestedId: z.string().describe('The original identifier from the request.').optional(),
    pmid: z.string().describe('The PubMed identifier when the article has one.').nullable().optional(),
    pmcid: z.string().describe('The PubMed Central identifier when the article is represented in PMC.').nullable().optional(),
    doi: z.string().describe('The DOI when PMC reports one.').nullable().optional(),
    mid: z.string().describe('The author manuscript identifier when PMC reports one.').nullable().optional(),
    error: z.string().describe('The PMC ID Converter error when the requested identifier could not be resolved.').nullable().optional(),
  }).describe('The available identifiers for one requested article.')).describe('One conversion result for each identifier returned by PMC.').optional(),
}).describe('The available identifier mappings returned by PMC.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const pubmedActions = {
  search_articles: {
    description: 'Search PubMed with the official query syntax and return normalized article records.',
    effect: 'read',
    inputSchema: searchArticlesInput,
    outputSchema: z.toJSONSchema(searchArticlesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  match_citation: {
    description: 'Match one raw biomedical citation to PubMed and return normalized candidate articles.',
    effect: 'write',
    inputSchema: matchCitationInput,
    outputSchema: z.toJSONSchema(matchCitationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_article: {
    description: 'Get one normalized PubMed article by PMID.',
    effect: 'read',
    inputSchema: getArticleInput,
    outputSchema: z.toJSONSchema(getArticleOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_articles: {
    description: 'Get multiple normalized PubMed articles by PMID in one request.',
    effect: 'read',
    inputSchema: getArticlesInput,
    outputSchema: z.toJSONSchema(getArticlesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  find_related_articles: {
    description: 'Find normalized PubMed articles related to one source PMID.',
    effect: 'read',
    inputSchema: findRelatedArticlesInput,
    outputSchema: z.toJSONSchema(findRelatedArticlesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_citing_articles: {
    description: 'Get normalized PubMed articles known to cite one source PMID. PubMed citation coverage depends on data supplied by publishers and NCBI sources and may be incomplete.',
    effect: 'read',
    inputSchema: getCitingArticlesInput,
    outputSchema: z.toJSONSchema(getCitingArticlesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_article_references: {
    description: 'Get normalized PubMed references for one source PMID. References are available only when supplied by publishers or recoverable from PMC data.',
    effect: 'read',
    inputSchema: getArticleReferencesInput,
    outputSchema: z.toJSONSchema(getArticleReferencesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  convert_article_ids: {
    description: 'Convert PMID, PMCID, DOI, or author manuscript identifiers with the PMC ID Converter. Complete mappings are available only for articles represented in PubMed Central.',
    effect: 'write',
    inputSchema: convertArticleIdsInput,
    outputSchema: z.toJSONSchema(convertArticleIdsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
