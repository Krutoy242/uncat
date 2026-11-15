/*
 * Invertible token grammar built as a product of feature-contributed tables,
 * where one declarative description of a body and its surrounding marks drives
 * both the scanner and the printer, keeping recognition and synthesis in step.
 */
import { Exit, Schema } from 'effect'
import * as mr from 'multi-integer-range'
import { Body, Fragment, Scanner, Span, SyntaxEntry } from './model.ts'

export const escapeRegex = (text: string): string => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')

export class Compiled {
  readonly body: Body
  readonly regex: RegExp
  readonly groups: ReadonlyArray<readonly [string, Fragment]>
  constructor(body: Body, regex: RegExp, groups: ReadonlyArray<readonly [string, Fragment]>) {
    this.body = body
    this.regex = regex
    this.groups = groups
  }
}

export class Parsed {
  readonly feature: string
  readonly span: Span
  readonly payload: unknown
  readonly marks: Readonly<Record<string, string>>
  readonly label: string
  constructor(fields: {
    readonly feature: string
    readonly span: Span
    readonly payload: unknown
    readonly marks: Readonly<Record<string, string>>
    readonly label: string
  }) {
    this.feature = fields.feature
    this.span = fields.span
    this.payload = fields.payload
    this.marks = fields.marks
    this.label = fields.label
  }
}

export const applicable = (fragment: Fragment, body: Body): boolean =>
  body.accepts.includes(fragment.position) && (fragment.sigils.length === 0 || fragment.sigils.includes(body.sigil))

const ordered = (
  fragments: ReadonlyArray<Fragment>,
  body: Body,
  position: Fragment['position'],
): ReadonlyArray<Fragment> =>
  fragments
    .filter((fragment) => fragment.position === position && applicable(fragment, body))
    .toSorted((a, b) => a.rank - b.rank)

export const compile = (body: Body, fragments: ReadonlyArray<Fragment>, sigils: ReadonlyArray<string>): Compiled => {
  const groups: Array<readonly [string, Fragment]> = []
  const section = (position: Fragment['position']): string =>
    ordered(fragments, body, position)
      .map((fragment) => {
        const name = `g${groups.length}`
        groups.push([name, fragment])
        return `(?:(?<${name}>${fragment.pattern(body.sigil)}))?`
      })
      .join('')
  const boundary = `(?<![\\p{L}\\p{N}_${sigils.map(escapeRegex).join('')}])`
  const lead = section('lead')
  const prefix = section('prefix')
  const suffixes = section('suffix')
  const source = `${boundary}${lead}${escapeRegex(body.sigil)}${prefix}(?<body>${body.pattern})${suffixes}`
  return new Compiled(body, new RegExp(source, 'gu'), groups)
}

const decoders = new WeakMap<Schema.Codec<unknown, string>, (input: unknown) => Exit.Exit<unknown, unknown>>()

const encoders = new WeakMap<Schema.Codec<unknown, string>, (input: unknown) => string>()

export const encode = (codec: Schema.Codec<unknown, string>, value: unknown): string => {
  const cached = encoders.get(codec)
  const encoder = cached ?? Schema.encodeSync(codec)
  if (cached === undefined) encoders.set(codec, encoder)
  return encoder(value)
}

export const decode = (codec: Schema.Codec<unknown, string>, text: string): Exit.Exit<unknown, unknown> => {
  const cached = decoders.get(codec)
  const decoder = cached ?? Schema.decodeUnknownExit(codec)
  if (cached === undefined) decoders.set(codec, decoder)
  return decoder(text)
}

export const scan = (compiled: Compiled, text: string): ReadonlyArray<Parsed> => {
  const found: Array<Parsed> = []
  for (const match of text.matchAll(compiled.regex)) {
    const groups = match.groups ?? {}
    const bodyText = groups['body'] ?? ''
    const payload = decode(compiled.body.codec, bodyText)
    if (Exit.isFailure(payload)) continue
    const marks: Record<string, string> = {}
    let valid = true
    let suffixText = ''
    for (const [name, fragment] of compiled.groups) {
      const piece = groups[name]
      if (piece === undefined) continue
      if (Exit.isFailure(decode(fragment.codec, piece))) valid = false
      marks[fragment.feature] = piece
      if (fragment.position === 'suffix') suffixText += piece
    }
    if (!valid) continue
    found.push(
      new Parsed({
        feature: compiled.body.feature,
        span: new Span({ start: match.index, end: match.index + match[0].length }),
        payload: payload.value,
        marks,
        label: compiled.body.label(bodyText, suffixText),
      }),
    )
  }
  return found
}

export const print = (
  body: Body,
  bodyText: string,
  fragments: ReadonlyArray<Fragment>,
  marks: Readonly<Record<string, string>>,
): string => {
  const piece = (position: Fragment['position']): string =>
    ordered(fragments, body, position)
      .map((fragment) => marks[fragment.feature] ?? '')
      .join('')
  return `${piece('lead')}${body.sigil}${piece('prefix')}${bodyText}${piece('suffix')}`
}

export const lineFragment = (fragment: string): mr.MIR | undefined => {
  const match = /^L(\d+)(?:-L?(\d+))?$/.exec(fragment)
  if (match === null) return undefined
  const from = Number(match[1])
  const to = match[2] === undefined ? from : Number(match[2])
  return mr.normalize([[Math.max(1, Math.min(from, to)), Math.max(1, from, to)]])
}

const positionRank: Readonly<Record<Fragment['position'], number>> = { suffix: 0, prefix: 1, lead: 2 }

export const syntaxOf = (grammar: {
  readonly bodies: ReadonlyArray<Body>
  readonly fragments: ReadonlyArray<Fragment>
  readonly scanners: ReadonlyArray<Scanner>
}): ReadonlyArray<SyntaxEntry> => {
  const bodies = [...grammar.bodies].toSorted((a, b) => b.sigil.localeCompare(a.sigil) || a.priority - b.priority)
  const scanners = [...grammar.scanners].toSorted((a, b) => b.priority - a.priority)
  const fragments = [...grammar.fragments].toSorted(
    (a, b) => positionRank[a.position] - positionRank[b.position] || a.rank - b.rank,
  )

  const bodyEntries = bodies.map(
    (body) =>
      new SyntaxEntry({
        feature: body.feature,
        tokens: body.samples.map((sample) => print(body, encode(body.codec, sample), grammar.fragments, {})),
        description: body.description,
      }),
  )

  const scannerEntries = scanners.map(
    (scanner) =>
      new SyntaxEntry({
        feature: scanner.feature,
        tokens: scanner.samples.map((sample) => encode(scanner.codec, sample)),
        description: scanner.description,
      }),
  )

  const fragmentEntries = fragments.map((fragment) => {
    const seenSigils = new Set<string>()
    const baseBodies = bodies.filter((body) => {
      if (!applicable(fragment, body) || body.samples.length === 0 || seenSigils.has(body.sigil)) return false
      seenSigils.add(body.sigil)
      return true
    })
    const tokens = baseBodies.flatMap((body) => {
      const bodyText = encode(body.codec, body.samples[0])
      const marks = fragment.samples(body.sigil).map((sample) => encode(fragment.codec, sample))
      const preceding = ordered(grammar.fragments, body, fragment.position).filter(
        (other) => other.rank < fragment.rank,
      )
      const combined = Object.fromEntries(
        preceding.flatMap((other) => {
          const first = other.samples(body.sigil)[0]
          return first === undefined ? [] : [[other.feature, encode(other.codec, first)] as const]
        }),
      )
      const hasCombined = Object.keys(combined).length > 0
      return marks.flatMap((mark) => {
        const solo = print(body, bodyText, grammar.fragments, { [fragment.feature]: mark })
        return hasCombined
          ? [solo, print(body, bodyText, grammar.fragments, { ...combined, [fragment.feature]: mark })]
          : [solo]
      })
    })
    return new SyntaxEntry({ feature: fragment.feature, tokens, description: fragment.description })
  })

  return [...bodyEntries, ...scannerEntries, ...fragmentEntries]
}

const backtick = (token: string): string => (token.includes('`') ? `\`\` ${token} \`\`` : `\`${token}\``)

export const formatSyntaxMarkdown = (grammar: {
  readonly bodies: ReadonlyArray<Body>
  readonly fragments: ReadonlyArray<Fragment>
  readonly scanners: ReadonlyArray<Scanner>
}): string =>
  syntaxOf(grammar)
    .map((entry) => `- ${entry.tokens.map(backtick).join(', ')} — ${entry.description}`)
    .join('\n')
