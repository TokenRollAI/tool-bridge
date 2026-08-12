/**
 * ConvertAPI 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const convertPdfToDocxInput = z.strictObject({
  fileUrl: z.url().describe('The publicly accessible PDF URL to convert.'),
  fileName: z.string().max(200).describe('The optional output file name to request from ConvertAPI. ConvertAPI appends the correct extension when needed.').optional(),
  timeout: z.int().min(10).max(1200).describe('The conversion timeout in seconds.').optional(),
  password: z.string().describe('The password used to open a protected PDF document.').optional(),
  pageRange: z.string().describe('The PDF page range to convert, for example 1-10 or 1,3,5.').optional(),
  layout: z.enum(['flowing', 'continuous', 'exact']).describe('How ConvertAPI should reconstruct the PDF page layout in the DOCX output.').optional(),
  ocrMode: z.enum(['auto', 'force', 'never']).describe('How ConvertAPI should apply OCR during conversion.').optional(),
  ocrLanguage: z.enum(['auto', 'ar', 'ca', 'zh', 'da', 'nl', 'en', 'fi', 'fr', 'de', 'el', 'ko', 'it', 'ja', 'no', 'pl', 'pt', 'ro', 'ru', 'sl', 'es', 'sv', 'tr', 'ua', 'th']).describe('The OCR language code to use for text recognition, or auto for automatic detection.').optional(),
  ocrEngine: z.enum(['native', 'tesseract']).describe('The OCR engine ConvertAPI should use for text recognition.').optional(),
  annotations: z.enum(['textBox', 'comment', 'none']).describe('How ConvertAPI should handle PDF annotations in the DOCX output.').optional(),
}).describe('The input payload for converting a public PDF URL to a DOCX file with ConvertAPI.')

export const convertPdfToDocxOutput = z.strictObject({
  conversionCost: z.int().describe('The amount deducted from the ConvertAPI balance.').optional(),
  files: z.array(z.strictObject({
    fileName: z.string().describe('The converted file name.').optional(),
    fileExt: z.string().describe('The converted file extension.').optional(),
    fileSize: z.int().describe('The converted file size in bytes.').optional(),
    fileId: z.string().describe('The ConvertAPI temporary file ID.').optional(),
    url: z.url().describe('The ConvertAPI temporary download URL for the converted file.').optional(),
    transitFile: z.strictObject({
      fileId: z.string().min(1).describe('The local transit file identifier.').optional(),
      downloadUrl: z.url().describe('The local URL for downloading the transit file.').optional(),
      sizeBytes: z.number().describe('The transit file size in bytes.').optional(),
      name: z.string().min(1).describe('The transit file name.').optional(),
      mimeType: z.string().min(1).describe('The transit file MIME type.').optional(),
    }).describe('A copy of a converted file stored in local transit storage.').nullable().optional(),
  }).describe('A converted file returned by ConvertAPI.')).min(1).describe('The converted DOCX files returned by ConvertAPI.'),
}).describe('The output payload for a ConvertAPI PDF to DOCX conversion.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const convertapiActions = {
  convert_pdf_to_docx: {
    description: 'Convert a publicly accessible PDF URL to DOCX with ConvertAPI and return temporary file download URLs.',
    effect: 'write',
    inputSchema: convertPdfToDocxInput,
    outputSchema: z.toJSONSchema(convertPdfToDocxOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
