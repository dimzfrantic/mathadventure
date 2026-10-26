import { fireEvent, render, screen } from '@testing-library/react'
import App from '../src/App'

describe('Math Adventure entry', () => {
  it('renders 00.1-A by default and exposes 00.1-B through activity navigation', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '00.1-A · Memasangkan' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Math Adventure' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pasangkan astronaut dan roket' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '00.1-B · Membagikan' }))
    expect(screen.getByRole('heading', { name: 'Membagikan satu untuk setiap teman' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '00.1-A · Memasangkan' }))
    expect(screen.getByRole('heading', { name: 'Pasangkan astronaut dan roket' })).toBeInTheDocument()
  })
})
