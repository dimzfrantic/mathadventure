import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChildRedemption } from '../src/features/math-drill/ChildRedemption'
import App from '../src/App'

const base = { totalEarned: 3, pendingStars: 0, confirmedStars: 0, availableStars: 3, rupiahPerStar: 500, minStarsPerRedemption: 1, maxStarsPerRedemption: 100, recentTransactions: [] }
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response
beforeEach(() => { sessionStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear() })

describe('Tukar Bintang UI', () => {
  it('appears within existing Math Drill entry, without a new activity route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(base)))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Math Drill · Latihan' }))
    expect(await screen.findByText('Tukar Bintang')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pilih aktivitas' })).toBeNull()
  })
  it('shows four authoritative balances, preview, and pending success without parent actions or key exposure', async () => {
    let summary = { ...base, recentTransactions: [] as unknown[] }
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/child-summary')) return json(summary)
      if (url.endsWith('/child-requests')) {
        summary = { ...summary, pendingStars: 2, availableStars: 1, recentTransactions: [{ status: 'pending', starsRedeemed: 2, rupiahValue: 1000, requestedAt: 1 }] }
        return json({ status: 'success', transaction: { status: 'pending' } }, 201)
      }
      throw new Error('Unexpected URL')
    }))
    render(<ChildRedemption />)
    expect(await screen.findByText('Bisa ditukar: 3')).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Tukar Bintang'))
    expect(await screen.findByText('3', { selector: '[data-testid="child-earned"]' })).toBeInTheDocument()
    expect(screen.getByTestId('child-available')).toHaveTextContent('3')
    expect(screen.getByTestId('child-pending')).toHaveTextContent('0')
    expect(screen.getByTestId('child-confirmed')).toHaveTextContent('0')
    const input = screen.getByLabelText('Jumlah bintang')
    fireEvent.change(input, { target: { value: '2' } })
    expect(screen.getByTestId('child-preview')).toHaveTextContent('Rp 1.000')
    const button = screen.getByRole('button', { name: 'Ajukan ke Orang Tua' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(await screen.findByText(/permintaan terkirim/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('child-available')).toHaveTextContent('1'))
    expect(screen.getByTestId('child-earned')).toHaveTextContent('3')
    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Jumlah bintang') as HTMLInputElement).value).toBe('1')
    expect(screen.getByText(/menunggu orang tua/i)).toBeInTheDocument()
    expect(calls.filter(call => call.url.endsWith('/child-requests'))).toHaveLength(1)
    const payload = JSON.parse(calls.find(call => call.url.endsWith('/child-requests'))!.init!.body as string)
    expect(Object.keys(payload).sort()).toEqual(['requestKey', 'starsRedeemed'])
    expect(payload.starsRedeemed).toBe(2)
    expect(calls.every(call => !call.init?.headers || !('X-API-Key' in (call.init.headers as object)) && !('X-Parent-Session' in (call.init.headers as object)))).toBe(true)
    expect(screen.queryByRole('button', { name: /Konfirmasi|Batalkan/i })).toBeNull()
  })

  it('retries the same intent after an ambiguous network failure even when stars were reserved', async () => {
    let summary = { ...base, recentTransactions: [] as unknown[] }
    const submittedKeys: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/child-summary')) return json(summary)
      const payload = JSON.parse(init?.body as string)
      submittedKeys.push(payload.requestKey)
      if (submittedKeys.length === 1) {
        summary = { ...summary, pendingStars: 2, availableStars: 1, recentTransactions: [{ status: 'pending', starsRedeemed: 2, rupiahValue: 1000, requestedAt: 1 }] }
        throw new Error('response lost after commit')
      }
      return json({ status: 'success', idempotent: true }, 200)
    }))
    render(<ChildRedemption />)
    fireEvent.click(await screen.findByText('Tukar Bintang'))
    fireEvent.change(await screen.findByLabelText('Jumlah bintang'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Orang Tua' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/belum pasti/i)
    fireEvent.click(screen.getByRole('button', { name: 'Perbarui saldo' }))
    await waitFor(() => expect(screen.getByTestId('child-available')).toHaveTextContent('1'))
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan ke Orang Tua' }))
    expect(await screen.findByText(/permintaan terkirim/i)).toBeInTheDocument()
    expect(submittedKeys).toHaveLength(2)
    expect(submittedKeys[0]).toBe(submittedKeys[1])
    expect(sessionStorage.getItem('math-child-redemption-intent')).toBeNull()
  })

  it('rejects invalid input, does not fabricate balance on failure, and keeps retry key on network ambiguity', async () => {
    let requests = 0
    let rejectRequest: ((reason?: unknown) => void) | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/child-summary')) return json(base)
      if (url.endsWith('/child-requests')) {
        requests++
        return new Promise<Response>((_resolve, reject) => { rejectRequest = reject })
      }
      throw new Error('unexpected')
    }))
    render(<ChildRedemption />)
    fireEvent.click(await screen.findByText('Tukar Bintang'))
    const input = await screen.findByLabelText('Jumlah bintang')
    fireEvent.change(input, { target: { value: '4' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/bintang|tersedia/i)
    fireEvent.change(input, { target: { value: '2' } })
    const button = screen.getByRole('button', { name: 'Ajukan ke Orang Tua' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(requests).toBe(1)
    rejectRequest?.(new Error('offline'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/belum pasti|jaringan/i)
    expect(sessionStorage.getItem('math-child-redemption-intent')).not.toBeNull()
    expect(screen.getByTestId('child-available')).toHaveTextContent('3')
  })
})
