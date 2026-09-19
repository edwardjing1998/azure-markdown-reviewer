import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";

const endpoint = process.env.AZURE_STORAGE_ENDPOINT;
const containerName = process.env.AZURE_STORAGE_CONTAINER;

const outputPrefix = normalizePrefix(
  process.env.AZURE_STORAGE_OUTPUT_PREFIX || "generated/",
);

if (!endpoint || !containerName) {
  throw new Error(
    "Set AZURE_STORAGE_ENDPOINT and AZURE_STORAGE_CONTAINER.",
  );
}

const container = new BlobServiceClient(
  endpoint,
  new DefaultAzureCredential(),
).getContainerClient(containerName);

export function normalizePrefix(value) {
  const cleaned = String(value || "")
    .replace(/^\/+/, "")
    .replace(/\.{2}/g, "");

  return cleaned && !cleaned.endsWith("/")
    ? `${cleaned}/`
    : cleaned;
}

function isAllowedGeneratedBlob(name) {
  return (
    name.startsWith(outputPrefix) ||
    /^[0-9a-f-]{36}\/generated\//i.test(name)
  );
}

export function assertAllowedBlob(name) {
  if (
    !name ||
    name.includes("..") ||
    name.startsWith("/") ||
    !isAllowedGeneratedBlob(name)
  ) {
    throw new Error(
      "Blob path is outside the configured generated prefix.",
    );
  }

  return name;
}

export async function listPages(
  prefix = outputPrefix,
) {
  const normalizedPrefix = normalizePrefix(prefix);
  const pages = [];

  for await (const blob of container.listBlobsFlat({
    prefix: normalizedPrefix,
  })) {
    if (!blob.name.endsWith("/content.md")) {
      continue;
    }

    const relative = blob.name.slice(
      normalizedPrefix.length,
      -"/content.md".length,
    );

    const parts = relative
      .split("/")
      .filter(Boolean);

    if (parts.length < 1) {
      continue;
    }

    pages.push({
      id: relative,
      bookId: parts[0],
      chapterId: parts.length > 1
        ? parts[1]
        : "",
      pageId: parts
        .slice(2)
        .join("/"),
      markdownBlob: blob.name,
      modifiedAt:
        blob.properties.lastModified?.toISOString() ||
        null,
    });
  }

  return pages.sort((a, b) =>
    a.id.localeCompare(
      b.id,
      undefined,
      { numeric: true },
    ),
  );
}

export async function downloadText(
  name,
  optional = false,
) {
  assertAllowedBlob(name);

  const client = container.getBlobClient(name);

  try {
    return await streamToText(
      await client.download(),
    );
  } catch (error) {
    if (
      optional &&
      error.statusCode === 404
    ) {
      return null;
    }

    throw error;
  }
}

export async function downloadBlob(
  name,
  allowSource = false,
) {
  if (
    !name ||
    name.includes("..") ||
    name.startsWith("/")
  ) {
    throw new Error("Invalid blob path.");
  }

  if (!allowSource) {
    assertAllowedBlob(name);
  }

  return container
    .getBlobClient(name)
    .download();
}

async function streamToText(response) {
  const chunks = [];

  for await (
    const chunk of response.readableStreamBody
  ) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function configuredPrefix() {
  return outputPrefix;
}