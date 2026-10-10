import { render, screen } from '@testing-library/react'
import App from '../src/App'

describe('Math Adventure foundation', () => {
  it('renders the foundation status', () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Math Adventure' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Phase 1 — Project Foundation')
  })
})
