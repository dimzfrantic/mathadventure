export interface AcceptanceCapabilitySource {
  readonly isSecureContext?: boolean
  readonly crypto?: { readonly subtle?: unknown; readonly getRandomValues?: unknown; readonly randomUUID?: unknown }
  readonly indexedDB?: unknown
}

export interface AcceptanceCapabilities {
  readonly secureContext: boolean
  readonly subtleCrypto: boolean
  readonly secureRandom: boolean
  readonly randomUUID: boolean
  readonly indexedDB: boolean
}

export function inspectAcceptanceCapabilities(source: AcceptanceCapabilitySource): AcceptanceCapabilities {
  return {
    secureContext: source.isSecureContext === true,
    subtleCrypto: typeof source.crypto?.subtle !== 'undefined',
    secureRandom: typeof source.crypto?.getRandomValues === 'function',
    randomUUID: typeof source.crypto?.randomUUID === 'function',
    indexedDB: typeof source.indexedDB !== 'undefined' && source.indexedDB !== null,
  }
}
