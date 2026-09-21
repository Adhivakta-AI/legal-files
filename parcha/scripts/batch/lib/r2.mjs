import { createReadStream } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { fromIni } from "@aws-sdk/credential-provider-ini"

export const BUCKET = process.env.R2_BUCKET ?? "lex"

function accountId() {
  const value = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!value) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID is required (source it from backend/.env)"
    )
  }
  return value
}

export function r2Client() {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId()}.r2.cloudflarestorage.com`,
    credentials: fromIni({ profile: process.env.R2_PROFILE ?? "r2" }),
    // R2 rejects the streaming-trailer checksums newer SDKs send by default.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
}

export async function getObjectToFile(client, key, destination) {
  const response = await client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  )
  await pipeline(response.Body, createWriteStream(destination))
}

export async function getObjectStream(client, key) {
  const response = await client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  )
  return Readable.from(response.Body)
}

export async function putFile(client, key, source, contentType) {
  const { size } = await stat(source)
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: createReadStream(source),
      ContentLength: size,
      ...(contentType ? { ContentType: contentType } : {}),
    })
  )
  return size
}

export async function putBuffer(client, key, body, contentType) {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ...(contentType ? { ContentType: contentType } : {}),
    })
  )
  return body.length
}

export async function deleteObject(client, key) {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export async function objectExists(client, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return true
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return false
    if (error?.name === "NotFound") return false
    throw error
  }
}

export async function readJsonFile(path) {
  return JSON.parse(await readFile(path, "utf8"))
}

/**
 * Manifest `pdf_key` values are archive-relative (`data/pdf/year=1994/...`).
 * The batch mirror re-roots them under the batch's own `pdfs/` prefix.
 */
export function mirroredPdfKey(batch, pdfKey) {
  const relative = String(pdfKey).replace(/^data\/pdf\//, "")
  return `batch-data/batch-${batch}/pdfs/${relative}`
}
