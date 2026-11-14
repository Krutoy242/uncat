/*
 * First pass of two-pass canonical widening: unions every requested extent of
 * the same source and subtracts what the input already contains, so the
 * renderer can emit each source once and attest every later mention instead.
 */
import * as mr from 'multi-integer-range'
import { Feature, defineFeature } from '../program/program.ts'

export const feature: Feature = defineFeature({
  name: 'dedup',
  refine: () => ({
    plan: (occurrences, attested) => {
      const unions = new Map<string, mr.MIR>()
      for (const occurrence of occurrences) {
        unions.set(occurrence.identity, mr.append(unions.get(occurrence.identity) ?? [], occurrence.extent))
      }
      for (const attestation of attested) {
        const union = unions.get(attestation.identity)
        if (union !== undefined) unions.set(attestation.identity, mr.subtract(union, attestation.extent))
      }
      return unions
    },
  }),
})
