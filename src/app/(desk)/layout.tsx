import './desk.css'

// Private radar pages use the desk design system (desk.css), not the marketing kit.
export default function DeskLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children
}
