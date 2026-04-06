import { Environment, EnvironmentSchemaVersion } from "@hoppscotch/data"
import * as O from "fp-ts/Option"
import * as TE from "fp-ts/TaskEither"
import { z } from "zod"

import { safeParseJSON } from "~/helpers/functional/json"
import { IMPORTER_INVALID_FILE_FORMAT } from "."
import { uniqueID } from "~/helpers/utils/uniqueID"
import { replacePMVarTemplating } from "./postman"

const postmanEnvSchema = z
  .object({
    name: z.string(),
    values: z.array(
      z
        .object({
          key: z.string(),
          value: z
            .union([z.string(), z.number(), z.boolean()])
            .transform(String), // Allow different types, convert to string
          type: z.string().optional().default("default"), // Make type optional
          enabled: z.boolean().optional(), // Allow enabled field
        })
        .passthrough() // Allow additional fields like id, etc.
    ),
  })
  .passthrough() // Allow additional fields like id, createdAt, owner, etc.

export const postmanEnvImporter = (contents: string[]) => {
  const parsedContents = contents.map((str) => safeParseJSON(str, true))
  if (parsedContents.some((parsed) => O.isNone(parsed))) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  const parsedValues = parsedContents.flatMap((parsed) => {
    let data = O.toNullable(parsed) as any

    if (!data) return []

    // Handle array format: [{environment: {...}}]
    if (Array.isArray(data)) {
      // Check if array has one element with 'environment' property
      if (data.length === 1 && data[0]?.environment) {
        data = data[0].environment
        return [data]
      }
      return data
    }

    // Handle object format: {environment: {...}}
    if (data.environment) {
      data = data.environment
    }

    // Wrap single object in array
    return [data]
  })

  const validationResult = z.array(postmanEnvSchema).safeParse(parsedValues)

  if (!validationResult.success) {
    return TE.left(IMPORTER_INVALID_FILE_FORMAT)
  }

  // Convert `values` to `variables` to match the format expected by the system
  const environments: Environment[] = validationResult.data.map(
    ({ name, values }) => ({
      id: uniqueID(),
      v: EnvironmentSchemaVersion,
      name,
      variables: values.map(({ key, value, type }) => ({
        key,
        initialValue: replacePMVarTemplating(value),
        currentValue: replacePMVarTemplating(value),
        secret: type === "secret",
      })),
    })
  )

  return TE.right(environments)
}
