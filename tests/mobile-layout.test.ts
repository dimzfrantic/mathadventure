import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const matchingCss = readFileSync(resolve(process.cwd(), 'src/matching.css'), 'utf8')
const distributionCss = readFileSync(resolve(process.cwd(), 'src/distribution.css'), 'utf8')

describe('mobile layout CSS contracts', () => {
  it('keeps both matching groups in two columns and object targets in one column on phones', () => {
    expect(matchingCss).toMatch(/@media\s*\(max-width:\s*700px\)[\s\S]*?\.board-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(matchingCss).toMatch(/\.token-list\s*\{[^}]*grid-template-columns:\s*1fr/)
    expect(matchingCss).toMatch(/\.adventure-shell\s*\.token\s*\{[^}]*min-height:\s*(?:8[0-9]|9[0-9]|[1-9][0-9]{2})px/)
  })

  it('keeps the stock tray accessible while the receiver grid is scrolled', () => {
    expect(distributionCss).toMatch(/\.distribution-stock\s*\{[^}]*position:\s*sticky/)
    expect(distributionCss).toMatch(/\.distribution-stock\s*\{[^}]*top:\s*[^;]+;/)
    expect(distributionCss).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*?\.distribution-recipients\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    expect(distributionCss).not.toMatch(/(?:html|body)\s*\{[^}]*overflow:\s*hidden/)
  })

  it('keeps stock reachable during short landscape sessions', () => {
    expect(distributionCss).toMatch(/@media\s*\(max-height:\s*500px\)\s*and\s*\(max-width:\s*900px\)[\s\S]*?\.distribution-stock\s*\{[^}]*position:\s*sticky/)
  })
})
