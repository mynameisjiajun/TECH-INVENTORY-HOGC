export function isNotFoundError(error) {
  return error?.code === "PGRST116";
}

export function mutationError(prefix, error) {
  return error?.message ? `${prefix}: ${error.message}` : prefix;
}

export function withWarnings(body, warnings) {
  if (!warnings.length) return body;
  return { ...body, warnings };
}

export async function insertRowsBestEffort({
  client,
  table,
  entries,
  warnings,
  context,
}) {
  if (!entries.length) return true;

  const { error } = await client.from(table).insert(entries);
  if (error) {
    warnings.push(mutationError(`Failed to create ${context}`, error));
    return false;
  }

  return true;
}

export async function deleteStorageObjectBestEffort({
  bucket,
  path,
  warnings,
  context,
}) {
  if (!path) return true;

  const { error } = await bucket.remove([path]);
  if (error) {
    warnings.push(mutationError(`Failed to clean up ${context}`, error));
    return false;
  }

  return true;
}
